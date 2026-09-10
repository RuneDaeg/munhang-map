/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server');
const {
  textRuns,
  formatRuns,
  unformattedText,
  plainToSource,
  splitFormattedText,
} = require('../lib/text-formatting.ts');
const { prepareHwpxTextStyles } = require('../lib/hwpx-text-styles.ts');
const { docxQuestionContent } = require('../lib/table-export.ts');
const MathText = require('../components/math-text.tsx').default;
const {
  parseQuestionContent,
  splitTableRow,
} = require('../lib/question-content.ts');
test('bold and underline overlap and round trip without exposing arbitrary HTML', () => {
  const source = '일반 <b>굵게 <u>강조</u></b> <u>밑줄</u>';
  const runs = textRuns(source);
  assert.equal(unformattedText(source), '일반 굵게 강조 밑줄');
  assert.deepEqual(textRuns(formatRuns(runs)), runs);
  assert.equal(plainToSource('<b>abcd</b>', 2), 5);
  assert.equal(unformattedText('<b>미완성'), '<b>미완성');
  const html = renderToStaticMarkup(
    React.createElement(MathText, {
      text: source + '<img src=x onerror=alert(1)>',
    }),
  );
  assert.match(html, /<strong>/);
  assert.match(html, /<u>/);
  assert.doesNotMatch(html, /<img/);
});
test('formatting a whole question preserves box fences, grid cells and header separators', () => {
  const source =
    '발문\n:::box <보기>\nㄱ. 예시 문장\n:::\n:::table\n| 조건 | 값 |\n| --- | --- |\n| A | 12 |\n:::';
  const styled = formatRuns([{ text: source, bold: true, underline: true }]);
  const blocks = parseQuestionContent(styled);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['text', 'box', 'table'],
  );
  assert.equal(blocks[2].rows.length, 2);
  assert.equal(blocks[2].header, true);
  assert.match(blocks[2].rows[0][0], /<b><u>/);
  assert.equal(unformattedText(styled), source);
});
test('price cells are literal dollars while delimited math still retains inner pipes', () => {
  assert.deepEqual(splitTableRow('| $20 | $30 | $|x|$ |'), [
    '$20',
    '$30',
    '$|x|$',
  ]);
  assert.deepEqual(splitTableRow('| $20$ | 3 |'), ['$20$', '3']);
});
test('formatting keeps complete math pipes together and manual splitting balances tags', () => {
  const source = ':::table\n| 조건 | 값 |\n| --- | --- |\n| A | $|x|$ |\n:::';
  const styled = formatRuns([{ text: source, bold: true, underline: false }]);
  assert.match(
    renderToStaticMarkup(React.createElement(MathText, { text: styled })),
    /katex/,
  );
  assert.deepEqual(splitFormattedText('<b>abcdef</b>', 6), [
    '<b>abc</b>',
    '<b>def</b>',
  ]);
});
test('DOCX uses native bold and underline runs; HWPX adds distinct styles without altering originals', () => {
  const source = '앞 <b>굵게</b> <u>밑줄</u> <b><u>함께</u></b>';
  const docx = docxQuestionContent(source);
  assert.match(docx, /<w:b\/>/);
  assert.match(docx, /<w:u w:val="single"\/>/);
  assert.doesNotMatch(docx, /&lt;[bu]&gt;/);
  const header = fs.readFileSync(
      'public/hwpx-template/Contents/header.xml',
      'utf8',
    ),
    styles = prepareHwpxTextStyles(header);
  for (const part of header.matchAll(/<hh:charPr\b[\s\S]*?<\/hh:charPr>/g))
    assert.ok(styles.header.includes(part[0]));
  assert.match(styles.header, /<hh:underline type="BOTTOM"/);
  const output = styles.runs(source);
  assert.doesNotMatch(output, /&lt;[bu]&gt;/);
  assert.equal(
    new Set([...output.matchAll(/charPrIDRef="(\d+)"/g)].map((m) => m[1])).size,
    4,
  );
});
