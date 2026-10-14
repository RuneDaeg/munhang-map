/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { extractHwpxQuestions } = require('../lib/hwpx-analysis.ts');
const { serializeReview, parseReview } = require('../lib/review-file.ts');
const { parseAnswerKeyText, previewAnswerMatches } = require('../lib/answer-key.ts');
const { questionLabel } = require('../lib/question-context.ts');

// All content is invented. These fixtures describe the parser's public block
// structure without retaining a teacher's book, answer key, or other files.
const fingerprint = 'b'.repeat(64);
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=';
const paragraph = (plainText, extras = {}) => ({ kind: 'paragraph', text: plainText, plainText, runs: [{ kind: 'text', text: plainText, bold: false, underline: false }], pageBreak: false, ...extras });
const picture = id => paragraph(`[삽입 그림 ${id}]`, { runs: [{ kind: 'image', imageId: id, alt: `합성 그림 ${id}` }] });
function table(rows) {
  const cells = rows.flatMap((row, r) => row.map((value, c) => {
    const blocks = Array.isArray(value) ? value : [paragraph(value)];
    return { row: r, column: c, rowSpan: 1, colSpan: 1, blocks, text: blocks.map(b => b.text).join('\n'), plainText: blocks.map(b => b.plainText).join('\n') };
  }));
  return { kind: 'table', rows: rows.length, columns: Math.max(...rows.map(r => r.length)), cells,
    text: cells.map(cell => cell.text).join('\n'), plainText: cells.map(cell => cell.plainText).join('\n') };
}
const metadata = (code = 'SYNTH-001', number = '001', unit = '01', page = '006') => table([[`#강 ${unit}`, `#쪽 ${page}`, `#번 ${number}`, `#문항코드 ${code}`]]);
function document(blocks, extras = {}) {
  return { format: 'hwpx', blocks, text: blocks.map(b => b.text).join('\n'), plainText: blocks.map(b => b.plainText).join('\n'),
    sections: [{ index: 0, path: 'Contents/section0.xml', blocks, text: blocks.map(b => b.text).join('\n') }],
    images: [], warnings: [], notes: [], hasOriginalPageCaptures: false, ...extras };
}
const extract = (blocks, extras = {}) => extractHwpxQuestions(document(blocks, extras), fingerprint, 'synthetic-book.hwpx', []);
const bookQuestion = (code, number = '001', body = '합성 문제를 읽고 답하시오.') => [metadata(code, number), paragraph('[문제]'), paragraph(body), paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[해설]'), paragraph('합성 해설입니다.')];

test('metadata table separates question, answer and explanation; image references follow their own section', async () => {
  const blocks = [paragraph('교재명 합성 교재 Page 1'), metadata(), paragraph('[문제]'), paragraph('본문은 $x^2$이다.'),
    table([['99. 표 안의 번호는 문항 시작이 아님', [picture('question-image')]]]), paragraph('[정답/모범답안]'), paragraph('③'),
    paragraph('[해설]'), paragraph('EXPLANATION_SYNTHETIC'), table([[[picture('explanation-image')]]])];
  const images = ['question-image', 'explanation-image', 'unreferenced-image'].map(id => ({ id, path: `BinData/${id}.png`, mimeType: 'image/png', dataUrl: imageUrl }));
  const source = document(blocks, { images }), before = JSON.stringify(source);
  const [question] = extractHwpxQuestions(source, fingerprint, 'synthetic-book.hwpx', []);
  assert.equal(JSON.stringify(source), before, 'extraction does not mutate source blocks');
  assert.equal(question.number, 1); assert.equal(question.sourceQuestionNumber, 1); assert.equal(question.sourceItemId, 'SYNTH-001');
  assert.equal(question.sectionLabel, '01강 · 006쪽'); assert.equal(question.answer, '③');
  assert.match(question.text, /본문은 \$x\^2\$/); assert.match(question.text, /99\. 표 안의 번호/);
  assert.doesNotMatch(question.text, /#강|#쪽|#번|#문항코드|\[문제\]|\[정답|\[해설\]|EXPLANATION_SYNTHETIC|교재명/);
  assert.match(question.explanation, /EXPLANATION_SYNTHETIC/); assert.doesNotMatch(question.explanation, /본문은/);
  assert.deepEqual(question.sourceImages.map(image => image.id), ['question-image']);
  assert.deepEqual(question.explanationImages.map(image => image.id), ['explanation-image']);
  assert.equal(question.sourceFormat, 'hwpx'); assert.equal(question.sourceFingerprint, fingerprint);
  assert.deepEqual(question.questionCaptures, []); assert.equal(question.sourcePageImage, undefined);
  assert.equal(question.standardCode, ''); assert.equal(question.confidence, 0, 'no invented classification confidence');
  assert.equal(question.answerSource, 'synthetic-book.hwpx', 'answer provenance is a safe basename, never a label containing slash');
  const restored = (await parseReview(serializeReview('synthetic-book.hwpx', [question], []))).questions[0];
  assert.equal(restored.answerSource, question.answerSource); assert.equal(restored.sourceItemId, question.sourceItemId);
  assert.deepEqual(restored.sourceImages, question.sourceImages); assert.deepEqual(restored.explanationImages, question.explanationImages);
});

test('different unique book codes preserve repeated original numbers and reset section state', () => {
  const questions = extract([...bookQuestion('SYNTH-001'), ...bookQuestion('SYNTH-002', '001', '둘째 합성 문제입니다.')]);
  assert.deepEqual(questions.map(q => q.number), [1, 2]); assert.deepEqual(questions.map(q => q.sourceQuestionNumber), [1, 1]);
  assert.deepEqual(questions.map(q => q.sourceItemId), ['SYNTH-001', 'SYNTH-002']);
  assert.ok(questions.every(q => !q.analysisWarning)); assert.doesNotMatch(questions[0].text, /둘째/);
  assert.throws(() => extract([...bookQuestion('SYNTH-001'), ...bookQuestion('SYNTH-001')]), /중복 문항 코드/);
});

test('book category markers, literal placeholders and named exercises share answer identity without invented numbers', async () => {
  const fixtures = [
    ['#구분 01 #쪽 005 #번 001 #문항코드 SYNTH-CATEGORY', 1, undefined, '구분 01 · 005쪽', { category: '01', page: '005', questionLabel: '001' }],
    ['#강 $$ #쪽 @@ #번 008 #문항코드 SYNTH-PLACEHOLDER', 8, undefined, '$$강 · @@쪽', { unit: '$$', page: '@@', questionLabel: '008' }],
    ['#강 02 #쪽 020 #번 유형 익히기 #문항코드 SYNTH-PRACTICE', undefined, '유형 익히기', '02강 · 020쪽', { unit: '02', page: '020', questionLabel: '유형 익히기' }],
  ];
  const blocks = fixtures.flatMap(([header]) => [paragraph(header), paragraph('[문제]'), paragraph('합성 문제입니다.'), paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[해설]'), paragraph('합성 해설입니다.')]);
  const questions = extract(blocks);
  assert.deepEqual(questions.map(q => q.number), [1, 2, 3]);
  fixtures.forEach(([, number, label, section, metadata], index) => {
    assert.equal(questions[index].sourceQuestionNumber, number);
    assert.equal(questions[index].sourceQuestionLabel, label);
    assert.equal(questions[index].sectionLabel, section);
    assert.deepEqual(questions[index].sourceBookMetadata, metadata);
  });
  assert.equal(questionLabel(questions[2]), '02강 · 020쪽 · 유형 익히기');
  const parsed = parseAnswerKeyText(blocks.map(b => b.plainText).join('\n'));
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(previewAnswerMatches(questions, parsed.entries).map(m => m.status), ['matched', 'matched', 'matched']);
  assert.equal(parsed.entries[1].sourcePage, undefined, 'literal page placeholder is not guessed');
  const restored = (await parseReview(serializeReview('synthetic.hwpx', questions, []))).questions;
  restored.forEach((q, index) => {
    assert.equal(q.sourceQuestionLabel, questions[index].sourceQuestionLabel);
    assert.deepEqual(q.sourceBookMetadata, questions[index].sourceBookMetadata);
  });
});

test('book metadata rejects duplicate, unknown and mismatched markers rather than merging the next question', () => {
  for (const header of [
    '#강 01 #구분 02 #쪽 006 #번 001 #문항코드 SYNTH',
    '#구분 01 #쪽 006 #번 001 #번 002 #문항코드 SYNTH',
    '#강 01 #쪽 006 #번 001 #문항코드 SYNTH #정답 3',
    '#강 01 #쪽 006 #번 001x #문항코드 SYNTH',
    '#구분 01 #쪽 006 #번 #문항코드 SYNTH',
  ]) assert.throws(() => extract([...bookQuestion('GOOD'), paragraph(header), paragraph('[문제]'), paragraph('합성 문항'), paragraph('[정답/모범답안]'), paragraph('③')]), /문항|원문|고유 코드/);
});

test('general numbered HWPX uses numbered paragraphs and elective labels without splitting data tables', () => {
  const questions = extract([paragraph('제목'), paragraph('[미적분]'), paragraph('23. 첫 번째 합성 질문'),
    table([['1. 자료 항목', '2. 다른 자료 항목']]), paragraph('① 가 ② 나 ③ 다'), paragraph('24번 문항 두 번째 합성 질문'),
    paragraph('[기하]'), paragraph('문제 23) 세 번째 합성 질문')]);
  assert.deepEqual(questions.map(q => q.number), [1, 2, 3]); assert.deepEqual(questions.map(q => q.sourceQuestionNumber), [23, 24, 23]);
  assert.deepEqual(questions.map(q => q.sectionLabel), ['미적분', '미적분', '기하']);
  assert.match(questions[0].text, /1\. 자료 항목/); assert.doesNotMatch(questions[0].text, /두 번째|세 번째|제목|미적분/);
  assert.ok(questions.every(q => !q.answer && !q.explanation && !q.sourceItemId));
});

test('single-cell exam container unwraps explicit question paragraphs and warns on duplicate ordinary numbers', () => {
  const questions = extract([table([[[paragraph('1. 합성 첫 문제'), paragraph('첫 문제 설명'), paragraph('2. 합성 둘째 문제')]]]), paragraph('2. 반복된 원본 번호')]);
  assert.deepEqual(questions.map(q => q.sourceQuestionNumber), [1, 2, 2]);
  assert.match(questions[0].text, /첫 문제 설명/); assert.match(questions[2].analysisWarning, /반복/);
  assert.throws(() => extract([paragraph('문항 번호 없는 본문')]), /명시적인 문항 번호/);
});

test('footnotes and endnotes stop import instead of losing content or assigning answers automatically', () => {
  for (const kind of ['footnote', 'endnote']) {
    assert.throws(() => extract([paragraph('1. 독립된 합성 질문')], { notes: [{ kind, sectionPath: 'Contents/section0.xml', number: 1, text: 'NOTE_ANSWER_③', plainText: 'NOTE_ANSWER_③', blocks: [paragraph('NOTE_ANSWER_③')] }] }), /각주|미주|누락/);
  }
});

test('ambiguous or excessive answers remain unset with a visible warning', () => {
  for (const answer of ['\uE001', '\uFFFD', 'x'.repeat(501)]) {
    const [question] = extract([metadata(), paragraph('[문제]'), paragraph('합성 질문'), paragraph('[정답/모범답안]'), paragraph(answer), paragraph('[해설]'), paragraph('합성 해설')]);
    assert.equal(question.answer, undefined); assert.equal(question.answerSource, undefined); assert.match(question.analysisWarning, /정답을 안전하게 읽지 못/);
    assert.doesNotMatch(question.text, /정답|해설/);
  }
  const [question] = extract([metadata(), paragraph('[문제]'), paragraph('합성 질문 [한글 수식: MATRIX {a b}]'), paragraph('[정답/모범답안]'), paragraph('③')]);
  assert.match(question.analysisWarning, /지원하지 않는 한글 수식/);
});

test('1000 questions are accepted and 1001 fails without returning a truncated subset', () => {
  const numbered = Array.from({ length: 1000 }, (_, index) => paragraph(`${index + 1}. 합성 질문`));
  assert.equal(extract(numbered).length, 1000);
  assert.throws(() => extract([...numbered, paragraph('1001. 범위를 넘는 합성 질문')]), /1001문항|1,000문항/);
  const marked = Array.from({ length: 1000 }, (_, index) => bookQuestion(`SYNTH-${index + 1}`)).flat();
  assert.equal(extract(marked).length, 1000);
  assert.throws(() => extract([...marked, ...bookQuestion('SYNTH-1001')]), /1001문항|1,000문항/);
});

test('invalid identity and too many referenced body or explanation images fail before import completes', () => {
  const input = document([paragraph('1. 합성 질문')]);
  for (const value of ['', '../bad', 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => extractHwpxQuestions(input, value, 'synthetic.hwpx', []), /원본 식별자/);
  const images = Array.from({ length: 41 }, (_, index) => ({ id: `image${index}`, path: `BinData/image${index}.png`, mimeType: 'image/png', dataUrl: imageUrl }));
  for (const explanation of [false, true]) {
    const blocks = [metadata(), paragraph('[문제]'), paragraph('합성 질문'), ...(explanation ? [paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[해설]')] : []), ...images.map(image => picture(image.id)), ...(!explanation ? [paragraph('[정답/모범답안]'), paragraph('③')] : [])];
    assert.throws(() => extract(blocks, { images }), /40개/);
  }
});

test('marked book missing body, duplicate problem markers, or malformed metadata fails closed', () => {
  const fixtures = [
    [metadata(), paragraph('본문 앞의 문장')],
    [metadata(), paragraph('[문제]')],
    [metadata(), paragraph('[문제]'), paragraph('합성 질문'), paragraph('[문제]'), paragraph('중복 시작')],
    [metadata('SYNTH-001', '000'), paragraph('[문제]'), paragraph('합성 질문')],
    [metadata('SYNTH-001', '10001'), paragraph('[문제]'), paragraph('합성 질문')],
    [metadata('x'.repeat(201)), paragraph('[문제]'), paragraph('합성 질문')],
  ];
  for (const blocks of fixtures) assert.throws(() => extract(blocks), /문제|본문|문항 번호|고유 코드/);
});

test('unrecognized book metadata must not yield an empty success or fall back to exam heuristics', () => {
  for (const blocks of [
    [paragraph('#문항코드 SYNTH-001'), paragraph('1. 합성 질문')],
    [table([['#쪽 006', '#번 001', '#문항코드 SYNTH-001']]), paragraph('[문제]'), paragraph('합성 질문')],
    [table([['#강 01', '#쪽 006', '#번 001', '#문항코드']]), paragraph('1. 합성 질문')],
  ]) assert.throws(() => extract(blocks), /도서|문항|코드|구분/);
});

test('partially numeric source numbers and invalid marker transitions are rejected without leaking answers', () => {
  for (const blocks of [
    [metadata('SYNTH-001', '001x'), paragraph('[문제]'), paragraph('합성 질문')],
    [metadata(), paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[문제]'), paragraph('합성 질문')],
    [metadata(), paragraph('[문제]'), paragraph('합성 질문'), paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[정답/모범답안]'), paragraph('④')],
    [metadata(), paragraph('[문제]'), paragraph('합성 질문'), paragraph('[해설]'), paragraph('설명'), paragraph('[정답/모범답안]'), paragraph('③')],
  ]) assert.throws(() => extract(blocks), /도서|문항|번호|구분|정답|순서|단계/);
});

test('decimal prose stays in its question and unsupported shared passages fail closed', () => {
  const questions = extract([paragraph('1. 합성 질문'), paragraph('3.14는 원주율의 근삿값이다.'), paragraph('2. 다른 합성 질문')]);
  assert.equal(questions.length, 2); assert.match(questions[0].text, /3\.14/);
  for (const range of ['[1~2]', '[1～2]', '[1–2]']) {
    assert.throws(() => extract([paragraph(`${range} 공통 자료를 읽으시오.`), paragraph('1. 합성 질문'), paragraph('2. 합성 질문')]), /공통 지문|누락/);
  }
});

test('referenced GIF and WebP pictures fail closed for question and explanation sections', () => {
  for (const mimeType of ['image/gif', 'image/webp']) {
    const image = { id: 'unsupported', path: 'BinData/unsupported', mimeType, dataUrl: `data:${mimeType};base64,AAAA` };
    for (const explanation of [false, true]) {
      const blocks = [metadata(), paragraph('[문제]'), paragraph('합성 질문'), ...(!explanation ? [picture(image.id)] : []), paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[해설]'), paragraph('합성 해설'), ...(explanation ? [picture(image.id)] : [])];
      assert.throws(() => extract(blocks, { images: [image] }), /지원하지 않는 그림|PNG\/JPEG\/BMP/);
    }
  }
});

test('review import rejects duplicate internal numbers while repeated source numbers remain valid', async () => {
  const questions = extract([...bookQuestion('SYNTH-001'), ...bookQuestion('SYNTH-002')]);
  assert.deepEqual(questions.map(q => q.sourceQuestionNumber), [1, 1]);
  const serialized = serializeReview('synthetic-book.hwpx', questions, []);
  assert.equal((await parseReview(serialized)).questions.length, 2);
  const raw = JSON.parse(serialized); raw.questions[1].number = raw.questions[0].number;
  await assert.rejects(parseReview(JSON.stringify(raw)), /내부 문항 번호.*중복/);
});

test('missing image assets cannot silently disappear from question or explanation text', () => {
  for (const explanation of [false, true]) {
    const blocks = [metadata(), paragraph('[문제]'), paragraph('합성 질문'), ...(!explanation ? [table([[[picture('missing-image')]]])] : []),
      paragraph('[정답/모범답안]'), paragraph('③'), paragraph('[해설]'), paragraph('합성 해설'), ...(explanation ? [table([[[picture('missing-image')]]])] : [])];
    assert.throws(() => extract(blocks, { images: [], warnings: ['일부 삽입 그림을 읽지 못했습니다. 원문과 대조해 주세요.'] }), /그림|이미지/);
  }
});
