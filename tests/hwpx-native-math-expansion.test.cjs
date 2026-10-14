/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { hwpxEquationToLatex } = require('../lib/hwpx-import.ts');
const { latexToHwpScript } = require('../lib/hwpx-math.ts');
const { latexToOmml } = require('../lib/docx-math.ts');
const { questionStorageProblem } = require('../lib/question-storage-check.ts');

function converted(source, expected) {
  const latex = hwpxEquationToLatex(source);
  assert.equal(typeof latex, 'string', source);
  if (expected !== undefined) assert.equal(latex, expected, source);
  katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false });
  const native = latexToHwpScript(latex), omml = latexToOmml(latex);
  assert.equal(questionStorageProblem(`검증 $${latex}$`), null, source);
  assert.equal(typeof hwpxEquationToLatex(native), 'string', `native round trip: ${source}`);
  return { latex, native, omml };
}

test('documented case-insensitive commands and joined known commands retain operators', () => {
  const samples = [
    ['triangleH', String.raw`\triangle H`],
    ['triangle H=x', String.raw`\triangle H = x`],
    ['a times b', String.raw`a \times b`],
    ['2TIMES3', String.raw`2 \times 3`],
    ['bulletK', String.raw`\bullet K`],
    ['sini', String.raw`\sin i`],
    ['Sin x', String.raw`\sin x`],
    ['left(x right)', String.raw`\left( x \right)`],
    ['RM In', String.raw`\mathrm{In}`],
  ];
  for (const [source, expected] of samples) converted(source, expected);
  for (const source of ['triangleUNKNOWN', 'sqrtUNKNOWN', 'overROOT', 'rmMATRIX', 'imaginarycommand', 'image', 'sinhUNKNOWN'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});

test('case-sensitive Greek, arrows, limit names and indium are not conflated', () => {
  for (const [source, expected] of [
    ['delta+DELTA', String.raw`\delta + \Delta`],
    ['rarrow+RARROW', String.raw`\to + \Rightarrow`],
    ['larrow+LARROW', String.raw`\leftarrow + \Leftarrow`],
    ['lrarrow+LRARROW', String.raw`\leftrightarrow + \Leftrightarrow`],
    ['rm In+rm Cl', String.raw`\mathrm{In} + \mathrm{Cl}`],
    ['rm In_2', String.raw`\mathrm{In}_{\mathrm{2}}`],
    ['rm SIN', String.raw`\mathrm{SIN}`],
    ['rm IT', String.raw`\mathrm{IT}`],
    ['in', String.raw`\in`],
    ['lim_{x=0} x', String.raw`\lim_{{x = 0}} x`],
  ]) converted(source, expected);
  for (const source of ['Delta', 'Rarrow', 'Lrarrow', 'Lim x', 'LIM x', 'rm UNKNOWN'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});

test('complete symbol and accent commands win over joined-command prefixes', () => {
  const symbols = {
    TIMES: '\\times', CDOT: '\\cdot', DIVIDE: '\\div', LEQ: '\\le', GEQ: '\\ge', NEQ: '\\ne',
    INF: '\\infty', IN: '\\in', NOTIN: '\\notin', SUBSET: '\\subset', SUBSETEQ: '\\subseteq',
    SUPSET: '\\supset', SUPSETEQ: '\\supseteq', SMALLINTER: '\\cap', CUP: '\\cup',
    EMPTYSET: '\\emptyset', APPROX: '\\approx', SIM: '\\sim', PROPTO: '\\propto',
    PARTIAL: '\\partial', NABLA: '\\nabla', SUM: '\\sum', PROD: '\\prod', INT: '\\int',
    DINT: '\\iint', TINT: '\\iiint', OINT: '\\oint', UNION: '\\bigcup', INTER: '\\bigcap',
    CDOTS: '\\cdots', LDOTS: '\\ldots', VDOTS: '\\vdots', DDOTS: '\\ddots',
    DEG: '{}^{\\circ}', CENTIGRADE: '{}^{\\circ}\\mathrm{C}', ANGLE: '\\angle',
    BOT: '\\perp', BULLET: '\\bullet', AST: '\\ast', TRIANGLE: '\\triangle', THEREFORE: '\\therefore',
  };
  for (const [command, expected] of Object.entries(symbols)) {
    assert.equal(hwpxEquationToLatex(command), expected, command);
    assert.equal(hwpxEquationToLatex(command.toLowerCase()), expected, command.toLowerCase());
  }
  for (const command of ['BAR', 'VEC', 'HAT', 'DOT', 'DDOT', 'TILDE', 'UNDER'])
    assert.equal(hwpxEquationToLatex(`${command.toLowerCase()} {A}`), hwpxEquationToLatex(`${command} {A}`));
  converted('CDOTS', String.raw`\cdots`);
  converted('cdots', String.raw`\cdots`);
  converted('DDOT {A}', String.raw`\ddot{{A}}`);
});

test('explicit bounded variable products keep every letter without accepting arbitrary words', () => {
  for (const [source, expected] of [
    ['PV=nRT', 'P V = n R T'],
    ['gt', 'g t'],
    ['{nRT} over {V}', String.raw`\frac{{n R T}}{{V}}`],
    ['F=mr omega^{2}', String.raw`F = m r \omega^{{2}}`],
    ['f={1} over {2 pi sqrt {LC}}', String.raw`f = \frac{{1}}{{2 \pi \sqrt{{L C}}}}`],
  ]) converted(source, expected);
  for (const source of ['PVUNKNOWN', 'nRTROOT', 'ROOT {3} OF {x}', 'MATRIX {x}', 'BOX {x}', 'Crystallin'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});

test('unbraced numeric ratios convert only when their whole scope is unambiguous', () => {
  for (const [source, expected] of [
    ['1over2', String.raw`\frac{1}{2}`],
    ['3 OVER 7', String.raw`\frac{3}{7}`],
    ['x=5over6', String.raw`x = \frac{5}{6}`],
    ['{1over2}+x', String.raw`{\frac{1}{2}} + x`],
    ['left(1over2 right)^n', String.raw`\left( \frac{1}{2} \right)^{n}`],
    ['a^{1over2}', String.raw`a^{{\frac{1}{2}}}`],
  ]) {
    const { native, omml } = converted(source, expected);
    assert.match(native, / OVER /);
    assert.match(omml, /<m:f>/);
  }
  for (const source of ['1over2n', '1over2 n', '1over2+3', 'a+b over c', 'nRT over V', 'x+1over2', '1over2^3', '1over2over3', 'x=1over2=3'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});

test('single operand radicals and accents convert while postfix and juxtaposition ambiguities remain native', () => {
  for (const [source, expected] of [
    ['sqrt2', String.raw`\sqrt{2}`],
    ['sqrtx', String.raw`\sqrt{x}`],
    ['sqrt2+3', String.raw`\sqrt{2} + 3`],
    ['sqrt{2x}', String.raw`\sqrt{{2 x}}`],
    ['bar AB', String.raw`\overline{A B}`],
    ['bar{rm PQ}', String.raw`\overline{{\mathrm{P} \mathrm{Q}}}`],
    ['vec x', String.raw`\vec{x}`],
    ['under x', String.raw`\underline{x}`],
  ]) converted(source, expected);
  for (const source of ['sqrt2x', 'sqrt2 x', 'sqrt2{x}', 'sqrt2 sin x', 'sqrt a^2', 'sqrt {a}^2', 'bar A B', 'BAR a_b', 'sqrtUNKNOWN', 'v prime ^2'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});

test('literal percent, superscript characters and circled labels survive both editable exports', () => {
  const percent = converted('a%', String.raw`a \%`);
  assert.match(percent.omml, />%<\/m:t>/);
  assert.match(percent.native, /%/);
  const unit = converted('m/s²', String.raw`m / s^{{2}}`);
  assert.match(unit.omml, /<m:sSup>/);
  assert.doesNotMatch(unit.omml, /<m:sPre>/);
  const circled = converted('ⓐ+ⓑ', String.raw`\text{ⓐ} + \text{ⓑ}`);
  for (const label of ['ⓐ', 'ⓑ']) {
    assert.ok(circled.native.includes(label));
    assert.ok(circled.omml.includes(label));
  }
  assert.equal(hwpxEquationToLatex('²'), undefined);
  assert.equal(hwpxEquationToLatex('x^2²'), undefined);
});

test('spacing, unknown control syntax and incomplete source still fail closed', () => {
  for (const source of ['T` _{1}', 'T~ _{1}', 'x^-1', 'rmNa^-1', 'rm K_{rma', 't=3t {} LSUB {0}', 'x \'\' ^2', 'fontmagic x', 'CASES {a # b}', 'color red x'])
    assert.equal(hwpxEquationToLatex(source), undefined, source);
});
