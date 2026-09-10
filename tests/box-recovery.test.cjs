/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { parseQuestionContent, questionPlainText, questionTextFromBlocks, restoreQuestionStructure } = require('../lib/question-content.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const MathText = require('../components/math-text.tsx').default;
const { docxQuestionContent, hwpxQuestionContent } = require('../lib/table-export.ts');

const plain = '그림은 관측 자료를 나타낸 것이다.\n( 가 ) 자료 A ( 나 ) 자료 B\n이에 대한 설명으로 옳은 것만을 < 보기 >에서 고른 것은? [2점]\n< 보 기 >\nㄱ . 자료 A는 첫 번째 관측 결과이다.\nㄴ . 자료 B의 값은 A보다 크다.\nㄷ . 두 자료의 측정 조건은\n같다.\n① ㄱ ② ㄴ ③ ㄱ, ㄷ ④ ㄴ, ㄷ ⑤ ㄱ, ㄴ, ㄷ';
const boxObject = { kind: 'box', title: '<보기>', text: 'ㄱ. 측정값은 12 cm이다.\nㄴ. 두 조건을 비교한다.', rows: [], header: false };
const objects = [{ kind: 'text', title: '', text: '다음은 측정 자료이다.', rows: [], header: false }, boxObject, { kind: 'text', title: '', text: '옳은 것을 고르시오. ① ㄱ ② ㄴ', rows: [], header: false }];
const image = 'data:image/jpeg;base64,/9j/2Q==';
const question = { number: 3, text: plain, sourcePageImage: image, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image }] };

test('plain OCR with spaced 보기 title and wrapped ㄱㄴㄷ becomes a box without an API call', () => {
  const blocks = parseQuestionContent(plain);
  const boxes = blocks.filter(block => block.kind === 'box');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].inferred, true);
  assert.ok(boxes[0].text.includes('조건은\n같다.'));
  assert.doesNotMatch(boxes[0].text, /①|고른 것은/);
  assert.match(blocks.at(-1).text, /^①/);
  const html = renderToStaticMarkup(React.createElement(MathText, { text: plain }));
  assert.match(html, /<section[^>]*aria-label="&lt;보기&gt;"/);
  assert.ok(html.indexOf('</section>') < html.indexOf('①'));
  const repaired = restoreQuestionStructure(plain);
  assert.equal(restoreQuestionStructure(repaired), repaired);
  assert.equal(questionPlainText(plain).replace(/\s/g, ''), plain.replace(/\s/g, ''));
});

test('flattened OCR and two separate labelled lists retain their choices outside boxes', () => {
  assert.equal(parseQuestionContent(plain.replace(/\n/g, ' ')).filter(block => block.kind === 'box').length, 1);
  const text = '<보기>\nㄱ. 자료 A\nㄴ. 자료 B\n① ㄱ ② ㄴ\n다음 자료\n<보기>\nㄱ. 자료 C\nㄴ. 자료 D\n① ㄱ ② ㄴ';
  assert.equal(parseQuestionContent(text).filter(block => block.kind === 'box').length, 2);
});

test('inferred 보기 is a native DOCX/HWPX table with all choices outside it', () => {
  const docx = docxQuestionContent(plain);
  assert.equal((docx.match(/<w:tbl>/g) || []).length, 1);
  assert.ok(docx.indexOf('</w:tbl>') < docx.indexOf('①'));
  let id = 1;
  const hwpx = hwpxQuestionContent(plain, { paragraph: text => `<hp:p id="${id++}"><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`, nextId: () => id++, border: 3, headerBorder: 4 });
  assert.equal((hwpx.match(/<hp:tbl\b/g) || []).length, 1);
  assert.ok(hwpx.indexOf('</hp:tbl>') < hwpx.indexOf('①'));
});

test('mentions, missing boundaries, incomplete fences and nonsequential labels are not guessed', () => {
  for (const text of ['<보기>에서 옳은 것을 고르시오.\nㄱ. A\nㄴ. B\n① ㄱ ② ㄴ', '<보기>\nㄱ. A\nㄴ. B', '<보기>\nㄱ. A\nㄷ. C\n① ㄱ ② ㄴ', ':::box\n<보기>\nㄱ. A\nㄴ. B\n① ㄱ ② ㄴ', '<보기>\nㄱ. A\nㄴ. B\n옳은 것은?\n① ㄱ ② ㄴ']) {
    assert.equal(parseQuestionContent(text).some(block => block.kind === 'box'), false);
    assert.equal(questionPlainText(text), text);
  }
});

test('typed block objects create boxes and grids without model-written ::: delimiters', () => {
  const text = questionTextFromBlocks(objects);
  assert.match(text, /:::box <보기>/);
  assert.deepEqual(parseQuestionContent(text).map(block => block.kind), ['text', 'box', 'text']);
  const grid = questionTextFromBlocks([{ kind: 'table', title: '결과', text: '', rows: [['식', '값'], [String.raw`$|x|+\frac{a}{b}$`, 'A|B']], header: true }]);
  assert.deepEqual(parseQuestionContent(grid)[0].rows[1], [String.raw`$|x|+\frac{a}{b}$`, 'A|B']);
  for (const invalid of [[], [{ ...boxObject, text: ':::box\n닫히지 않은 상자' }], [{ kind: 'table', title: '', text: '', rows: [['A', 'B'], ['1']], header: false }], [{ ...boxObject, text: 123 }]]) assert.equal(questionTextFromBlocks(invalid), undefined);
});

test('complete typed structure wins over a flat response, while partial blocks do not drop stems', async (t) => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  const typed = questionTextFromBlocks(objects);
  const base = questionPlainText(typed);
  global.fetch = async () => Response.json({ questions: [{ number: 3, latexText: base, blocks: objects }] });
  const result = await enhanceQuestionsWithVision([{ ...question, text: base }]);
  assert.equal(result.questions[0].text, typed);
  assert.deepEqual(result.warnings, []);
  global.fetch = async () => Response.json({ questions: [{ number: 3, latexText: plain, blocks: [boxObject] }] });
  const partial = await enhanceQuestionsWithVision([question]);
  assert.ok(partial.questions[0].text.includes('그림은 관측 자료'));
  assert.ok(partial.questions[0].text.includes('⑤'));
  assert.equal(partial.warnings.length, 1);
});

test('legacy flat responses are repaired and slightly longer flat summaries cannot erase valid boxes', async (t) => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => Response.json({ questions: [{ number: 3, latexText: plain }] });
  const recovered = await enhanceQuestionsWithVision([question]);
  assert.match(recovered.questions[0].text, /:::box <보기>/);
  assert.deepEqual(recovered.questions[0].questionCaptures, question.questionCaptures);
  const typed = questionTextFromBlocks(objects);
  global.fetch = async () => Response.json({ questions: [{ number: 3, latexText: typed, directStem: questionPlainText(typed) + ' [2점]' }] });
  const preserved = await enhanceQuestionsWithVision([{ ...question, text: questionPlainText(typed) }]);
  assert.match(preserved.questions[0].text, /:::box <보기>/);
  assert.ok(preserved.questions[0].text.includes('[2점]'));
});
