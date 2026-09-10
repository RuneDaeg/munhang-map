/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const { detectExamSubject } = require('../lib/exam-subject.ts');
const { classifyQuestion, parseStandardsCsv } = require('../lib/pdf-analysis.ts');
const { createDocxBytes, createHwpxBytesFromTemplate } = require('../lib/document-export.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const catalog = parseStandardsCsv(fs.readFileSync(path.join(__dirname, '../public/data/achievement-standards.csv'), 'utf8'));
const line = (text, x, y, width = 230) => ({ text, x, y, width, height: 12 });
const blankQuestion = { number: 1, type: 'test', text: 'X로 가장 적절한 것은?', standardCode: '', standard: '', confidence: 0, domain: '' };

test('two columns keep both stems, figure space, choices and the next question separate', () => {
  const page = layoutPage([
    line('고1 과학탐구 영역 (통합과학)', 170, 40, 300),
    line('1. 그림은 순수한 X와 태양 전지를 나타낸 것이다.', 25, 100),
    line('X', 90, 230, 8), line('태양 전지', 190, 230, 45),
    line('X로 가장 적절한 것은? [1.5점]', 25, 265),
    line('① 고무 ② 구리 ③ 규소 ④ 나무 ⑤ 유리', 25, 290),
    line('2. 다음은 구간 단속 시스템에 대한 설명이다.', 25, 340),
    line('1.5 km', 25, 390, 60), line('① 선택 ② 선택 ③ 선택', 25, 450),
    line('3. 그림은 판의 경계를 나타낸 것이다.', 320, 100),
    line('① A ② B ③ C', 320, 290),
  ], 600, 800, 1);
  assert.equal(page.columns.length, 2);
  const questions = locateQuestions([page]);
  assert.deepEqual(questions.map((q) => q.number), [1, 2, 3]);
  assert.match(questions[0].text, /순수한 X/);
  assert.match(questions[0].text, /X로 가장/);
  assert.match(questions[0].text, /⑤ 유리/);
  assert.doesNotMatch(questions[0].text, /판의 경계|구간 단속/);
  const [x, y, width, height] = questions[0].regions[0].box;
  assert.ok(x + width <= 0.5 && y * 800 <= 100 && (y + height) * 800 >= 302 && (y + height) * 800 < 340);
  assert.equal(detectExamSubject(page.headerText, catalog, 1).label, '통합과학');
});

test('a long one-column question is not treated as two columns', () => {
  const page = layoutPage([line('1. 설명이다.', 30, 100, 500), line('같은 줄이 페이지 중앙을 넘어간다.', 30, 180, 500), line('2. 두 번째 문항', 30, 400, 500)], 600, 800, 1);
  assert.equal(page.columns.length, 1);
  assert.equal(locateQuestions([page])[0].regions[0].box[2], 0.95);
});

test('gutter measurement includes short questions near the top of a page', () => {
  const items = [line('13. 왼쪽 문항', 80, 171, 260), line('14. 오른쪽 문항', 430, 171, 300)];
  items.push({ ...line('수학', 353, 125, 67), height: 36 });
  for (let i = 0; i < 16; i++) {
    items.push(line('왼쪽 본문', 90, 190 + i * 15, 260));
    // The right question is short: all its prose is above the top fifth.
    items.push(line('오른쪽 본문', 435 + (i % 4) * 65, 191 + Math.floor(i / 4) * 10, 50));
  }
  const page = layoutPage(items, 841, 1190, 5);
  assert.equal(page.columns.length, 2);
  assert.ok(page.columns[0].right > 350 && page.columns[1].left < 430);
  assert.deepEqual(locateQuestions([page]).map(q => q.number), [13, 14]);
});

test('a formula above the question number is retained rather than replaced by the stem', () => {
  const page = layoutPage([
    line('6', 100, 90, 7), line('1. 수식의 값은?', 30, 108, 500),
    line('① 1 ② 2 ③ 3 ④ 4 ⑤ 5', 30, 145, 500),
  ], 600, 800, 1);
  const question = locateQuestions([page])[0];
  assert.match(question.text, /^6\n수식의 값은\?/);
  assert.equal((question.text.match(/수식의 값은/g) || []).length, 1);
});

test('a stem beginning with a number is still a question, while decimal units are not', () => {
  const page = layoutPage([line('16. 이전 문제', 30, 100, 500), line('17. 100 g인 물체의 질량은?', 30, 300, 500), line('1.5 km', 30, 350, 60), line('18. 다음 문제', 30, 500, 500)], 600, 800, 1);
  assert.deepEqual(locateQuestions([page]).map((question) => question.number), [16, 17, 18]);
});

test('column detection accepts a question number and dot stored as separate PDF runs', () => {
  const page = layoutPage([line('1', 30, 100, 6), line('.', 37, 100, 3), line('그림 위 발문', 45, 100, 100), line('아래 발문', 30, 300), line('2', 320, 100, 6), line('.', 327, 100, 3), line('다른 단의 문항', 335, 100, 100)], 600, 800, 1);
  assert.equal(page.columns.length, 2);
  assert.deepEqual(locateQuestions([page]).map((question) => question.number), [1, 2]);
});

test('a question continuing on the next page retains both captures, without its masthead', () => {
  const pages = [
    layoutPage([line('고1 과학탐구 영역 (통합과학)', 30, 30, 400), line('1. 다음 자료를 보시오.', 30, 100, 500), line('다음 쪽으로 계속', 30, 600, 500)], 600, 800, 1),
    layoutPage([line('고1 과학탐구 영역 (통합과학)', 30, 30, 400), line('자료 아래 직접 발문이다.', 30, 110, 500), line('① 1 ② 2 ③ 3 ④ 4 ⑤ 5', 30, 145, 500), line('2. 다음 문제', 30, 200, 500)], 600, 800, 2),
  ];
  const questions = locateQuestions(pages);
  assert.deepEqual(questions[0].regions.map((r) => r.page), [1, 2]);
  assert.match(questions[0].text, /직접 발문/);
  assert.doesNotMatch(questions[0].text, /과학탐구 영역/);
});

test('shared passages are attached to each referring question', () => {
  const page = layoutPage([line('[1~2] 다음 글을 읽고 물음에 답하시오.', 30, 85, 500), line('공통 자료 내용', 30, 120, 500), line('1. 첫 번째 질문', 30, 250, 500), line('① 선택지', 30, 300), line('2. 두 번째 질문', 30, 400, 500)], 600, 800, 1);
  const questions = locateQuestions([page]);
  for (const question of questions) { assert.match(question.text, /공통 자료 내용/); assert.equal(question.regions.length, 2); }
});

test('unlocated boundaries visibly fall back to a page, not a claimed question crop', () => {
  const questions = locateQuestions([layoutPage([line('번호 없는 설명과 자료', 30, 100)], 600, 800, 1)]);
  assert.ok(questions[0].warning);
  assert.deepEqual(questions[0].regions[0].box, [0, 0, 1, 1]);
});

test('exam header scopes weak question text to integrated science, while explicit course choice persists', () => {
  const context = detectExamSubject('2025학년도 고1 과학탐구 영역 (통합과학)', catalog, 1);
  assert.deepEqual(context.subjectKeys.sort(), ['고등학교|통합과학1', '고등학교|통합과학2']);
  const question = classifyQuestion({ ...blankQuestion, examSubject: context }, catalog);
  assert.ok(question.subjectCandidates.every((candidate) => candidate.key.includes('통합과학')));
  const chosen = classifyQuestion(question, catalog, '고등학교|통합과학2');
  assert.equal(classifyQuestion({ ...chosen, text: '수소 원자 우주 생성' }, catalog).domain, '고등학교 · 통합과학2');
  assert.equal(detectExamSubject('고등학교 통합과학1', catalog, 1).subjectKeys.length, 1);
  assert.equal(detectExamSubject('고등학교 중국어', catalog, 1).label, '중국어');
  assert.equal(detectExamSubject('과학탐구 영역', catalog, 1), undefined);
  const korean = detectExamSubject('2025학년도 고3 국어 영역', catalog, 1);
  assert.ok(detectExamSubject('국어 영역', catalog, 2, korean).subjectKeys.every((key) => key.startsWith('고등학교|')));
});

test('AI sees the whole captured question and cannot replace it with a figure box', async (t) => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  const image = 'data:image/jpeg;base64,/9j/2Q==';
  const question = { ...blankQuestion, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image }], sourcePageImage: 'full page', examSubject: detectExamSubject('고1 통합과학', catalog, 1) };
  global.fetch = async (_url, options) => {
    const input = JSON.parse(options.body);
    assert.equal(input.image, image);
    assert.match(input.questions[0].text, /통합과학/);
    return Response.json({ questions: [{ number: 1, latexText: '전체 발문', indirectStem: '', directStem: '전체 발문', choices: [], questionBox: [0, 0, 1, 1], hasFigure: true, figureBox: [0.2, 0.2, 0.3, 0.3] }] });
  };
  const result = await enhanceQuestionsWithVision([question]);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.questions[0].questionCaptures, question.questionCaptures);
  assert.equal(result.questions[0].figureImage, undefined);
});

function unzipStored(bytes) {
  const result = new Map();
  const buffer = Buffer.from(bytes);
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const from = offset + 30 + nameLength + extra;
    result.set(name, buffer.subarray(from, from + size));
    offset = from + size;
  }
  return result;
}

test('DOCX and HWPX embed all continuation captures and support images above JS spread limits', () => {
  const jpeg = Buffer.alloc(300000, 17); jpeg[0] = 255; jpeg[1] = 216;
  const images = [jpeg, Buffer.from([255, 216, 255, 217])].map((data) => `data:image/jpeg;base64,${data.toString('base64')}`);
  const question = { ...blankQuestion, text: '\text{그림 위 발문}\n' + String.raw`\text{그림 아래 질문} $\frac{a}{b}$`, questionCaptures: images.map((image, i) => ({ page: i + 1, box: [0, 0, 1, 1], image })) };
  const docx = unzipStored(createDocxBytes('검증', [question]));
  assert.equal([...docx.keys()].filter((name) => name.startsWith('word/media/')).length, 2);
  assert.equal((docx.get('word/document.xml').toString().match(/<w:drawing>/g) ?? []).length, 2);
  assert.doesNotMatch(docx.get('word/document.xml').toString(), /ext\{|\t/);
  assert.match(docx.get('word/document.xml').toString(), /그림 위 발문<\/w:t><\/w:r><\/w:p>\s*<w:p>/);
  const template = new Map();
  const root = path.join(__dirname, '../public/hwpx-template');
  for (const file of fs.readdirSync(root, { recursive: true })) if (fs.statSync(path.join(root, file)).isFile()) template.set(file, fs.readFileSync(path.join(root, file)));
  const hwpx = unzipStored(createHwpxBytesFromTemplate('검증', [question], template));
  assert.equal([...hwpx.keys()].filter((name) => name.startsWith('BinData/')).length, 2);
  assert.equal((hwpx.get('Contents/section0.xml').toString().match(/<hp:pic /g) ?? []).length, 2);
  for (const name of ['Contents/section0.xml', 'Preview/PrvText.txt']) {
    assert.doesNotMatch(hwpx.get(name).toString(), /ext\{|\t/);
    assert.ok(hwpx.get(name).toString().includes(String.raw`그림 아래 질문 $\frac{a}{b}$`));
  }
});
