/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { parseQuestionContent, questionTextFromBlocks, questionPlainText, splitTableRow } = require('../lib/question-content.ts');
const { docxQuestionContent, hwpxQuestionContent } = require('../lib/table-export.ts');
const MathText = require('../components/math-text.tsx').default;

const source = ':::table 특징\n| 특징 | 값 |\n| --- | --- |\n| ∙ 첫째<br>∙ 둘째<br>∙ 셋째 | $\\frac{1}{2}$ |\n:::';

test('table bullet breaks round-trip as text without changing cells or math', () => {
  const [block] = parseQuestionContent(source);
  assert.equal(block.rows.length, 2);
  assert.equal(block.rows[1][0], '∙ 첫째\n∙ 둘째\n∙ 셋째');
  assert.equal(block.rows[1][1], '$\\frac{1}{2}$');
  assert.equal(questionTextFromBlocks([{ ...block, text: '' }]), source);
  assert.match(questionPlainText(source), /∙ 첫째\n∙ 둘째\n∙ 셋째/);
  assert.deepEqual(splitTableRow('| $x<br>y$ | a<br>b |'), ['$x<br>y$', 'a\nb']);
  for (const invalid of ['$a\n+b$', '$$a\n+b$$', '\\(a\n+b\\)', '$\\begin{cases}x&x>0\\\\\n0&x=0\\end{cases}$']) {
    assert.equal(questionTextFromBlocks([{ kind: 'table', title: '', text: '', rows: [[invalid]], header: false }]), undefined);
  }
  const inline = '$\\begin{cases}x&x>0\\\\0&x=0\\end{cases}$';
  const saved = questionTextFromBlocks([{ kind: 'table', title: '', text: '', rows: [[inline]], header: false }]);
  assert.ok(saved);
  assert.match(saved, /\\\\0/);
  assert.match(questionTextFromBlocks([{ kind: 'table', title: '', text: '', rows: [['∙ $x^2$\n∙ $y^2$']], header: false }]), /\$<br>∙ \$/);
});

test('preview renders actual text line breaks and never arbitrary cell HTML', () => {
  const html = renderToStaticMarkup(React.createElement(MathText, { text: source }));
  assert.match(html, /∙ 첫째\n∙ 둘째\n∙ 셋째/);
  assert.match(html, /katex/);
  assert.doesNotMatch(html, /&lt;br&gt;/);
  const unsafe = ':::table\n| <br onclick="alert(1)"> | <img src=x onerror="alert(1)"> |\n:::';
  const escaped = renderToStaticMarkup(React.createElement(MathText, { text: unsafe + '\noutside<br>text' }));
  assert.doesNotMatch(escaped, /<br\b|<img\b/);
  assert.match(escaped, /outside&lt;br&gt;text/);
});

test('DOCX and HWPX use existing multi-paragraph cells and reserve their height', () => {
  const docx = docxQuestionContent(source);
  const cell = [...docx.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)][2][0];
  assert.equal((cell.match(/<w:p>/g) || []).length, 3);
  assert.doesNotMatch(docx, /&lt;br&gt;|<br>/);
  assert.match(docx, /<m:f>/);
  const paragraphs = [];
  let id = 1;
  const hwpx = hwpxQuestionContent(source, { paragraph: text => {
    paragraphs.push(text); return `<hp:p><hp:t>${text}</hp:t></hp:p>`;
  }, nextId: () => id++, border: 1, headerBorder: 2 });
  assert.ok(paragraphs.includes('∙ 첫째') && paragraphs.includes('∙ 둘째') && paragraphs.includes('∙ 셋째'));
  const cells = [...hwpx.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)];
  assert.equal((cells[2][0].match(/<hp:p>/g) || []).length, 3);
  assert.ok(Number(cells[2][0].match(/<hp:cellSz[^>]*height="(\d+)"/)[1]) >= 6000);
  assert.doesNotMatch(hwpx, /<br>|&lt;br&gt;/);
});
