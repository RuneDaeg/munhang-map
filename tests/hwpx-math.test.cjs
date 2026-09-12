/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { latexToHwpScript, latexToHwpxEquation, measureHwpxMath } = require('../lib/hwpx-math.ts');

// Assert roles in the equation language, not just the presence of LaTeX text.
test('chemical symbols are roman, with charge and atom count on the same atom', () => {
  assert.equal(latexToHwpScript(String.raw`\mathrm{HCO^{−}_{3}}`), '{rm H} {rm C} {{rm O}} _ {3} ^ {-}');
  assert.equal(latexToHwpScript(String.raw`\mathrm{CO_{3}^{2-}}`), '{rm C} {{rm O}} _ {3} ^ {2 -}');
  assert.equal(latexToHwpScript(String.raw`\mathrm{CO_2}+\mathrm{H_2O}\to\mathrm{H_2CO_3}`), '{rm C} {{rm O}} _ {2} + {{rm H}} _ {2} {rm O} rarrow {{rm H}} _ {2} {rm C} {{rm O}} _ {3}');
  assert.equal(latexToHwpScript(String.raw`v_A`), '{{it v}} _ {{it A}}');
});

test('fractions, roots and nested scripts retain their argument boundaries', () => {
  assert.equal(latexToHwpScript(String.raw`\frac{a+\frac{b}{c}}{d}`), '{{it a} + {{it b}} OVER {{it c}}} OVER {{it d}}');
  assert.equal(latexToHwpScript(String.raw`\sqrt{x}+\sqrt[3]{y}`), 'SQRT {{it x}} + ROOT {3} OF {{it y}}');
  assert.equal(latexToHwpScript(String.raw`x_{i_j}^{n^2}`), '{{it x}} _ {{{it i}} _ {{it j}}} ^ {{{it n}} ^ {2}}');
  assert.equal(latexToHwpScript(String.raw`{}^{14}_{6}\mathrm{C}`), '{{rm C}} LSUB {6} LSUP {14}');
  assert.match(latexToHwpScript(String.raw`\binom{n}{r}`), /^LEFT \( .* ATOP .* RIGHT \)$/);
});

test('scientific exponents and text inside a fraction stay native', () => {
  const scientific = latexToHwpScript(String.raw`1.66\times10^{-27}\,\mathrm{kg}`);
  assert.match(scientific, /^1\.66 TIMES \{10\} \^ \{- 27\}/);
  assert.match(scientific, /\{rm k\} \{rm g\}$/);
  const words = latexToHwpScript(String.raw`\frac{\text{단위 부피당 이온 수}}{\text{전체 이온 수}}=\frac76`);
  assert.equal(words, '{{rm "단위 부피당 이온 수"}} OVER {{rm "전체 이온 수"}} = {7} OVER {6}');
  assert.doesNotMatch(words + scientific, /\\|\$|mathrm|frac|text\{/);
});

test('native large operators and limits retain lower and upper arguments', () => {
  assert.equal(latexToHwpScript(String.raw`\sum\limits_{i=1}^n a_i`), 'SUM _ {{it i} = 1} ^ {{it n}} {{it a}} _ {{it i}}');
  assert.equal(latexToHwpScript(String.raw`\lim\limits_{x\to0}\frac{\sin x}{x}`), 'lim _ {{it x} rarrow 0} {sin {it x}} OVER {{it x}}');
  assert.match(latexToHwpScript(String.raw`\int_0^1 x^2\mathrm{d}x`), /^\{INT\} _ \{0\} \^ \{1\}/);
  assert.match(latexToHwpScript(String.raw`\prod_{i=1}^n a_i`, { display: true }), /^PROD _ .* \^ /);
});

test('decorations, matrices and stretchy parentheses become native structures', () => {
  const decorated = latexToHwpScript(String.raw`\overline{AB}+\underline{CD}+\vec{x}+\widehat{ABC}`);
  for (const command of ['BAR', 'UNDER', 'VEC', 'HAT']) assert.match(decorated, new RegExp(`\\b${command} \\{`));
  const matrix = latexToHwpScript(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`);
  assert.equal(matrix, 'LEFT ( MATRIX {{{it a}} & {{it b}} # {{it c}} & {{it d}}} RIGHT )');
  assert.equal(latexToHwpScript(String.raw`\left(\frac12\right)`), 'LEFT ( {1} OVER {2} RIGHT )');
});

test('unsupported structures, fonts, unsafe text and malformed input fail visibly', () => {
  for (const source of ['', '\\frac{1}', String.raw`\noSuchCommand{x}`, String.raw`\color{red}{x}`, String.raw`\phantom{x}`, String.raw`\cancel{x}`, String.raw`\mathbb{R}`, String.raw`\mathsf{x}`, String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`, String.raw`\left\{x\middle|x>0\right\}`, '\\text{a"b}', '\\text{\\textbackslash frac}', 'a\u0001b', 'x'.repeat(20_001)]) {
    assert.throws(() => latexToHwpxEquation(source, { id: 1 }), /한글 편집형 수식으로 변환할 수 없습니다/, source);
  }
});

test('equation XML has the native inline envelope with renderer-calculated metrics', () => {
  const xml = latexToHwpxEquation(String.raw`x<y`, { id: 42, fontSizePt: 11 });
  assert.match(xml, /^<hp:equation id="42"/);
  assert.match(xml, /version="Equation Version 60" baseLine="0"/);
  assert.match(xml, /baseUnit="1100" lineMode="CHAR" font="HancomEQN"/);
  assert.match(xml, /<hp:sz width="0" widthRelTo="ABSOLUTE" height="0"/);
  assert.match(xml, /treatAsChar="1" affectLSpacing="1" flowWithText="1"/);
  assert.match(xml, /<hp:script>\{it x\} &lt; \{it y\}<\/hp:script>/);
  assert.deepEqual([...xml.matchAll(/<hp:([A-Za-z]+)\b/g)].map((m) => m[1]), ['equation', 'sz', 'pos', 'outMargin', 'script']);
  assert.doesNotMatch(xml, /<hp:t>|<hp:pic|<m:oMath|\\/);
  assert.notEqual(xml, latexToHwpxEquation(String.raw`x<y`, { id: 43, fontSizePt: 11 }));
  for (const id of [0, -1, 1.5, NaN, 0x1_0000_0000]) assert.throws(() => latexToHwpxEquation('x', { id }));
  for (const fontSizePt of [0, -10, Infinity, NaN, 101]) assert.throws(() => latexToHwpxEquation('x', { id: 1, fontSizePt }));
});

test('pre-layout estimates scale with font size and reserve height for fractions', () => {
  const plain = measureHwpxMath('x'), fraction = measureHwpxMath(String.raw`\frac{x}{y}`);
  assert.ok(fraction.height > plain.height);
  assert.ok(fraction.width > plain.width);
  assert.ok(fraction.baseline > 0 && fraction.baseline < fraction.height);
  const large = measureHwpxMath(String.raw`\frac{x}{y}`, { fontSizePt: 20 });
  for (const key of ['width', 'height', 'baseline']) assert.ok(Math.abs(large[key] - fraction[key] * 2) <= 1);
  const styled = latexToHwpScript('x+1', { bold: true, underline: true });
  assert.match(styled, /^UNDER \{BOLD \{/);
});
