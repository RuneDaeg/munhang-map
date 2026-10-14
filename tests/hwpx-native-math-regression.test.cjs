/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { hwpxEquationToLatex } = require('../lib/hwpx-import.ts');
const { latexToHwpScript } = require('../lib/hwpx-math.ts');
const { latexToOmml } = require('../lib/docx-math.ts');
const { questionStorageProblem } = require('../lib/question-storage-check.ts');
const { normalizeQuestionText } = require('../lib/math-normalization.ts');

function converted(source) {
  const latex = hwpxEquationToLatex(source);
  assert.equal(typeof latex, 'string', source);
  katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false });
  const native = latexToHwpScript(latex), omml = latexToOmml(latex);
  assert.equal(questionStorageProblem(`수식 $${latex}$`), null, source);
  return { latex, native, omml };
}

test('numeric native prescripts bind to the following atom, never a binary operator', () => {
  for (const source of ['Y+ _{0}^{1} rm n', 'Z＋ _{1}^{1} rm H', '_{1}^{2} rm H', 'A = ^{14}_{6} rm C', 'Y rarrow _{1}^{2} rm H', 'Y larrow _{1}^{2} rm H', 'Y lrarrow _{1}^{2} rm H', 'Y RARROW _{1}^{2} rm H']) {
    const { latex, native, omml } = converted(source);
    assert.match(latex, /\{\}_\{/);
    assert.doesNotMatch(latex, /(?:[+=]|\\(?:to|leftarrow|leftrightarrow|Rightarrow))[_^]/);
    assert.doesNotMatch(native, /\{[+=]\}\s*[_^]/);
    assert.match(native, /LSUB/);
    assert.match(native, /LSUP/);
    assert.match(omml, /<m:sPre>/);
    const again = hwpxEquationToLatex(native);
    assert.equal(typeof again, 'string');
    assert.match(latexToHwpScript(again), /LSUB/);
    assert.match(latexToHwpScript(again), /LSUP/);
  }
});

test('ordinary right subscripts and explicit native left scripts remain distinct', () => {
  const normal = converted('f_{1} + f_{2}');
  assert.doesNotMatch(normal.native, /LSUB|LSUP/);
  assert.doesNotMatch(normal.omml, /<m:sPre>/);
  assert.equal((normal.native.match(/ _ /g) ?? []).length, 2);
  for (const source of ['rm H LSUB {1} LSUP {2}', 'rm H LSUP {2} LSUB {1}', '{}_{1}^{2} rm H']) {
    const result = converted(source);
    assert.match(result.native, /LSUB \{1\} LSUP \{2\}/);
  }
  for (const source of ['x^-1', 'A + ^{2}', 'A+_{x}^{y} B', 'x LSUB {1} LSUB {2}', '{} LSUB {1}', '+_{0}^{1}', '+_{0}^{1} UNKNOWN']) {
    assert.equal(hwpxEquationToLatex(source), undefined, source);
  }
});

test('degree and Celsius marks are independent of the next atom in both editable document formats', () => {
  for (const source of ['30 DEG', 'DEG', '30 DEG C', '25 CENTIGRADE', 't_{1} CENTIGRADE', '30 ˚']) {
    const { native, omml } = converted(source);
    assert.match(native, /DEG/);
    assert.doesNotMatch(native, /LSUB|LSUP/);
    assert.doesNotMatch(omml, /<m:sPre>/);
  }
  assert.match(converted('TRIANGLE A').native, /TRIANGLE/);
  assert.match(converted('OMEGA _{x}').native, /OMEGA.* _ /);
});

test('roman chemical tokens, adjacent font declarations and ion charges retain case and scripts', () => {
  for (const source of ['rm CO _{2}', 'rm NaCl', 'rm NH _{3}', 'rm OH ^{-}', 'rmOH^-', 'rmNa^+', 'rm CH _{3} COOH', 'rmNaOH(itaq)', 'rmH_2 O', 'rm CO _3 ^{2-}', 'rmA(g)', 'rmB', 'rmX', 'rm1`mol', 'rmpH', 'rm A ^{*}', 'rm X ^{A*} Y', 'rm R ^{*\r\n}', 'rm 2 BULLET L']) {
    const { latex, native } = converted(source);
    assert.match(latex, /\\mathrm\{/);
    assert.match(native, /\brm\b/);
    assert.doesNotMatch(native, /LSUB|LSUP/);
  }
  const ion = converted('rmOH^-');
  assert.match(ion.native, /\^ \{-\}/);
  for (const source of ['rm UNKNOWN', 'rmMATRIX {x}', 'rm BOX {x}', 'rmBOX{x}', 'rm ROOT {2} OF {x}', 'rm FONTMAGIC', 'rmNa^-1']) {
    assert.equal(hwpxEquationToLatex(source), undefined, source);
  }
});

test('unmatched source delimiters never acquire manufactured nested dollars', () => {
  for (const source of [String.raw`아직 편집 중 $\frac{a}{b}`, String.raw`x $\sqrt{y}`, String.raw`2\$V$와 $\frac{1}{2} V$이다`]) {
    const normalized = normalizeQuestionText(source);
    assert.equal((normalized.match(/\$/g) || []).length, (source.match(/\$/g) || []).length);
    assert.doesNotMatch(normalized, /\$\$/);
    assert.equal(normalizeQuestionText(normalized), normalized);
    assert.notEqual(questionStorageProblem(normalized), null);
  }
  assert.equal(normalizeQuestionText(String.raw`정상 \frac{a}{b}`), String.raw`정상 $\frac{a}{b}$`);
});

test('existing standalone degree LaTeX exports without inventing a nuclear prescript', () => {
  for (const latex of [String.raw`30{}^{\circ}`, String.raw`30{}^{\circ}\mathrm{C}`, String.raw`30{}^{\circ}+x`, String.raw`{}^{\circ}C`]) {
    assert.match(latexToHwpScript(latex), /DEG/);
    assert.doesNotMatch(latexToHwpScript(latex), /LSUP/);
    assert.doesNotMatch(latexToOmml(latex), /<m:sPre>/);
  }
});
