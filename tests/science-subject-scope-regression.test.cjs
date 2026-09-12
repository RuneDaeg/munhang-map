/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectExamSubject } = require('../lib/exam-subject.ts');
const { classifyQuestion, parseStandardsCsv } = require('../lib/pdf-analysis.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const catalog = parseStandardsCsv(fs.readFileSync(path.join(__dirname, '../public/data/achievement-standards.csv'), 'utf8'));
const chemistry = ['고등학교|화학', '고등학교|물질과 에너지', '고등학교|화학 반응의 세계'].sort();

test('separate 화학 heading words survive boundary checks and stay in related high-school courses', () => {
  for (const header of [
    '2022학년도 대학수학능력시험 6월 모의평가 문제지\n과학탐구 영역 화학 I 3',
    '2022학년도 대학수학능력시험 6월 모의평가 문제지\n과학탐구 영역 화학 I I 3',
    '과학탐구 영역\n화학Ⅰ\n3',
    '과학탐구 영역\n화 학 Ⅱ\n3',
    '과학탐구 영역\n화\n학\nⅡ',
  ]) {
    const subject = detectExamSubject(header, catalog, 1);
    assert.equal(subject?.label, '화학');
    assert.deepEqual([...subject.subjectKeys].sort(), chemistry);
    assert.equal(subject.headerText, header, 'Keep the actual exam heading, not a curriculum-year claim');
    const question = classifyQuestion({ number: 1, text: '법 사회 자연수 독일어', examSubject: subject }, catalog);
    assert.ok(question.subjectCandidates.length > 0);
    assert.ok(question.subjectCandidates.every((candidate) => chemistry.includes(candidate.key)));
    assert.ok(question.standardCandidates.every((candidate) => catalog.some((record) =>
      record.code === candidate.code && chemistry.includes(`${record.school}|${record.subject}`))));
  }
});

test('short titles are not found inside other course words, but later valid occurrences are considered', () => {
  assert.equal(detectExamSubject('과학탐구 영역', catalog, 1), undefined);
  const noChinese = catalog.filter((record) => !record.subject.includes('중국어'));
  assert.equal(detectExamSubject('고등학교 중국어영역', noChinese, 1), undefined);
  assert.equal(detectExamSubject('고등학교 중국어와 국어 영역', noChinese, 1)?.label, '국어');
  assert.equal(detectExamSubject('고등학교 중국어 영역', catalog, 1)?.label, '중국어');
  const prior = detectExamSubject('고등학교 화학 I', catalog, 1);
  assert.deepEqual(detectExamSubject('화학 I', catalog, 2, prior).subjectKeys.sort(), chemistry);
  const selected = classifyQuestion({ number: 1, text: '용액', examSubject: prior }, catalog, '고등학교|화학');
  assert.equal(selected.selectedSubjectKey, '고등학교|화학');
});

test(
  'all eight science PDFs: each page heading and all 160 questions retain related high-school scope',
  { skip: !process.env.MUNHANG_SCIENCE_AUDIT_DIR },
  async () => {
    if (process.env.CODEX_CANVAS_MODULE) {
      const canvas = require(process.env.CODEX_CANVAS_MODULE);
      global.DOMMatrix = canvas.DOMMatrix;
      global.ImageData = canvas.ImageData;
      global.Path2D = canvas.Path2D;
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const files = fs.readdirSync(process.env.MUNHANG_SCIENCE_AUDIT_DIR)
      .filter((name) => /^0[1-8]\s.*\.pdf$/iu.test(name)).sort();
    assert.equal(files.length, 8);
    const expected = ['물리학', '화학', '생명과학', '지구과학', '물리학', '화학', '생명과학', '지구과학'];
    let total = 0;
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(fs.readFileSync(path.join(process.env.MUNHANG_SCIENCE_AUDIT_DIR, file))),
        fontExtraProperties: true,
        cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + path.sep,
        cMapPacked: true,
        standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
      }).promise;
      try {
        const pages = [], subjects = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
          const viewport = page.getViewport({ scale: 1 });
          const result = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS,
            (id) => page.commonObjs.get(id), pdfRules(operators, pdfjs.OPS, viewport.transform));
          const layout = layoutPage(result.items, viewport.width, viewport.height, n);
          const subject = detectExamSubject(layout.headerText, catalog, n, subjects.at(-1));
          assert.equal(subject?.label, expected[fileIndex], `${file}, page ${n}`);
          assert.ok(subject.subjectKeys.every((key) => key.startsWith('고등학교|')));
          pages.push(layout); subjects.push(subject);
        }
        const questions = locateQuestions(pages);
        assert.deepEqual(questions.map((question) => question.number), Array.from({ length: 20 }, (_, i) => i + 1));
        for (const question of questions) {
          const subject = subjects[question.page - 1];
          const classified = classifyQuestion({ ...question, examSubject: subject }, catalog);
          assert.ok(classified.subjectCandidates.length > 0 ||
            (!classified.standardCode && /판단을 보류/.test(classified.mappingReason ?? '')),
          'No compatible 2022 criterion is a legitimate unresolved result, never a reason to escape subject scope');
          assert.ok(classified.subjectCandidates.every((candidate) => subject.subjectKeys.includes(candidate.key)),
            `${file}, question ${question.number}: out-of-scope subject`);
          assert.ok(classified.standardCandidates.every((candidate) => catalog.some((record) =>
            record.code === candidate.code && subject.subjectKeys.includes(`${record.school}|${record.subject}`))));
          total++;
        }
      } finally {
        await pdf.destroy();
      }
    }
    assert.equal(total, 160);
  },
);
