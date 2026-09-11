/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { normalizeQuestionText } = require('../lib/math-normalization.ts');
const { numberedApiChoices, preserveQuestionParts } = require('../lib/question-completeness.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const { docxQuestionContent, hwpxQuestionContent } = require('../lib/table-export.ts');
const MathText = require('../components/math-text.tsx').default;

const labels = ['①', '②', '③', '④', '⑤'];
const prompt = '다음 글의 제목으로 가장 적절한 것은?';
const passage = 'Students at a small school keep a shared garden. They record how much water each plant receives and compare their notes every Friday. Working together helps them learn to ask careful questions.';
const choices = ['Learning Together in a Garden', 'Why Plants Need More Space', 'The History of School Buildings', 'Growing Food Without Water', 'A New Way to Travel to School'];
const numbered = choices.map((text, i) => `${labels[i]} ${text}`).join('\n');
const original = `${prompt}\n${passage}\n${numbered}`;
const flat = `${passage} ${choices.join(' ')}`;
const image = 'data:image/jpeg;base64,/9j/2Q==';
const question = { number: 24, text: original, sourcePageImage: image, questionCaptures: [{ page: 3, box: [0, 0, 0.5, 1], image }] };

test('English passage retains the Korean prompt and restores five choice numbers and lines', () => {
  const result = preserveQuestionParts(flat, original, choices);
  assert.equal(result.text, original);
  assert.equal(result.keptOriginal, false);
  assert.equal(result.warning, '');
  assert.equal(normalizeQuestionText(numbered), numbered);
});

test('source labels alone repair legacy flat output; existing labels are not doubled', () => {
  for (const candidate of [flat, original]) {
    const result = preserveQuestionParts(candidate, original, []);
    assert.equal(result.text, original);
    for (const label of labels) assert.equal(result.text.split(label).length - 1, 1);
  }
});

test('API choice array is usable when PDF text lacks circled glyphs', () => {
  assert.equal(preserveQuestionParts(flat, flat, choices).text, `${passage}\n${numbered}`);
  assert.deepEqual(numberedApiChoices(choices.map((text, i) => `${i + 1}. ${text}`)), numbered.split('\n'));
  assert.deepEqual(numberedApiChoices(choices.map((text, i) => `(${i + 1}) ${text}`)), numbered.split('\n'));
  assert.equal(preserveQuestionParts(flat, flat, choices, prompt).text, original);
});

test('a missing option keeps the original and warns instead of accepting a nearly complete long passage', () => {
  const result = preserveQuestionParts(`${passage} ${choices.slice(0, 4).join(' ')}`, original, choices.slice(0, 4));
  assert.equal(result.text, original);
  assert.equal(result.keptOriginal, true);
  assert.ok(result.warning);
});

test('an incomplete AI transcript can use intact source option sentences even without source glyphs', () => {
  const result = preserveQuestionParts(`${passage} ${choices.slice(0, 4).join(' ')}`, flat, choices);
  assert.equal(result.text, `${passage}\n${numbered}`);
  assert.equal(result.keptOriginal, true);
  assert.ok(result.warning);
});

test('numbering is not guessed from arbitrary prose or incomplete/mixed API entries', () => {
  assert.equal(preserveQuestionParts(flat, flat, []).text, flat);
  for (const entries of [choices.slice(0, 4), ['① A', 'B'], ['① A', '① B'], ['② A', '① B']]) {
    assert.deepEqual(numberedApiChoices(entries), []);
    const result = preserveQuestionParts(flat, flat, entries);
    assert.doesNotMatch(result.text, /[①②③④⑤]/);
    assert.ok(result.warning);
  }
  assert.deepEqual(numberedApiChoices(['② B', '④ D']), ['② B', '④ D']);
});

test('an earlier title quoted in the passage is not mistaken for the terminal choice list', () => {
  const intro = `${passage} The report was called ${choices[0]}.`;
  const result = preserveQuestionParts(`${intro} ${choices.join(' ')}`, `${prompt}\n${intro}\n${numbered}`, choices);
  assert.equal(result.text, `${prompt}\n${intro}\n${numbered}`);
});

test('inline English grammar markers stay in the passage, never become a terminal answer list', () => {
  const source = '다음 글의 밑줄 친 부분 중 어법상 틀린 것은?\nStudents ① work together and ② keep records. Each group ③ compares results and ④ asks questions before they ⑤ write a report.';
  const result = preserveQuestionParts(source.replace(/[①②③④⑤] /g, ''), source, ['work', 'keep', 'compares', 'asks', 'write']);
  assert.equal(result.text, source);
  assert.equal(result.keptOriginal, false);
});

test('AI response completion, compact preview and both document serializers keep labels', async (t) => {
  const before = global.fetch; t.after(() => { global.fetch = before; });
  global.fetch = async () => Response.json({ questions: [{ number: 24, latexText: flat, choices }] });
  const result = await enhanceQuestionsWithVision([question]);
  assert.equal(result.questions[0].text, original);
  assert.deepEqual(result.questions[0].questionCaptures, question.questionCaptures);
  assert.deepEqual(result.warnings, []);
  const html = renderToStaticMarkup(React.createElement(MathText, { text: result.questions[0].text, compact: true }));
  assert.match(html, /whitespace-pre-wrap/);
  const docx = docxQuestionContent(result.questions[0].text);
  let id = 1;
  const hwpx = hwpxQuestionContent(result.questions[0].text, { paragraph: text => `<hp:p id="${id++}"><hp:t>${text}</hp:t></hp:p>`, nextId: () => id++, border: 3, headerBorder: 4 });
  for (const output of [html, docx, hwpx]) for (const label of labels) assert.equal(output.split(label).length - 1, 1);
});

test('long structured text missing only one short choice cannot replace a complete flat result', async (t) => {
  const before = global.fetch; t.after(() => { global.fetch = before; });
  const longPassage = passage.repeat(10);
  const full = `${prompt}\n${longPassage}\n${numbered}`;
  const partial = `${prompt}\n${longPassage}\n${numbered.split('\n').slice(0, 4).join('\n')}`;
  global.fetch = async () => Response.json({ questions: [{ number: 24, latexText: full, choices, blocks: [{ kind: 'text', title: '', text: partial, rows: [], header: false }] }] });
  const result = await enhanceQuestionsWithVision([{ ...question, text: full }]);
  assert.equal(result.questions[0].text, full);
  assert.ok(result.warnings.length);
});
