/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { docxQuestionContent } = require('../lib/table-export.ts');
const { createDocxBytes } = require('../lib/document-export.ts');

test('DOCX prose, boxes and table cells share native math and literal newline handling', () => {
  const source = '던진 속력은 $v_{A}$이다.\n:::box\n◦ 이산화탄소 $CO_2$와 탄산 칼슘 $CaCO_3$\\n◦ 다음 자료\n:::\n:::table\n| 속력 | 극한 |\n| --- | --- |\n| $v_B$ | $\\lim_{x\\to3}\\frac{x^2-x-6}{x-3}$ |\n:::';
  const xml = docxQuestionContent(source);
  assert.equal((xml.match(/<m:oMath>/g) || []).length, 5);
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 2);
  assert.match(xml, /<m:limLow>/);
  assert.match(xml, /<m:sSub>/);
  assert.match(xml, /<m:sty m:val="p"\/>/);
  assert.doesNotMatch(xml, /\$|\\n|\\frac|\\mathrm/);
  assert.match(xml, /◦ 다음 자료/);
});

test('multiline cases remain one complete equation inside prose and nested boxes', () => {
  const formula = '$$f(x)=\\begin{cases}x^2&x>0\\\\\n0&x\\le0\\end{cases}$$';
  for (const source of [formula, `:::box\n앞 문장\n${formula}\n뒷 문장\n:::`]) {
    const xml = docxQuestionContent(source);
    assert.equal((xml.match(/<m:oMath>/g) || []).length, 1);
    assert.equal((xml.match(/<m:mr>/g) || []).length, 2);
    assert.doesNotMatch(xml, /\$|\\begin|\\end/);
  }
});

test('bold and underline are retained when selected text includes a formula', () => {
  const xml = docxQuestionContent('<b><u>속력 $v_A$</u></b>');
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:u w:val="single"\/>/);
  assert.match(xml, /<m:oMath>/);
});

test('export declares the math namespace and reports the offending question on invalid math', () => {
  const question = {number:9,text:'속력 $v_A$',standardCode:'',domain:'',standard:''};
  const bytes = Buffer.from(createDocxBytes('검증', [question]));
  assert.ok(bytes.includes(Buffer.from('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"')));
  for (const text of ['$x^{2}^{3}$', '$v_A', '$\\unsupported{x}$', '$a\n+b$', '속력 $<b>v_A</b>$이다.']) {
    assert.throws(() => createDocxBytes('검증', [{...question,text}]), /9번 문항:/);
  }
  assert.doesNotThrow(() => docxQuestionContent('① $10\n② $20\n③ $30\n④ $40\n⑤ $50'));
});
