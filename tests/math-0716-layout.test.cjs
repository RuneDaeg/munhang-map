/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const run = (text, x, baseline, height = 10, width = 5, extra = {}) => ({
  text, x, y: baseline - height, baseline, height, width, equation: true, ...extra,
});
const prose = (text, x, baseline, width) => run(text, x, baseline, 10.5, width, { equation: false });
function check(input, rules = []) {
  const before = JSON.stringify(input), result = reconstructMathRuns(input, rules);
  assert.equal(result.sourceConserved, true);
  assert.equal(JSON.stringify(input), before);
  for (const r of result.items) if (r.text.startsWith('$')) {
    assert.doesNotThrow(() => katex.renderToString(r.text.slice(1, -1), { throwOnError: true, strict: false }));
  }
  return result;
}
const text = result => result.items.map(r => r.text).join(' ');
const variants = input => [input, input.toReversed(), input.map(r => ({ ...r,
  x: r.x * 2 + 31, y: r.y * 2 + 17, baseline: r.baseline * 2 + 17,
  width: r.width * 2, height: r.height * 2,
}))];

test('grouped lower limits retain their operator identity despite styled source runs', () => {
  for (const input of variants([run('lim', 20, 30, 12, 17, { sourceMathLatex: '\\mathrm{lim}' }),
    run('x → 2', 20, 37, 7, 17, { sourceMathLatex: '\\mathit{x} → 2' })])) {
    assert.equal(text(check(input)), '$\\lim_{\\mathit{x} → 2}$');
  }
  for (const input of variants([run('Σ', 20, 30, 18, 13), run('k = 1', 19, 36, 7, 15), run('n', 24, 16, 7, 4)])) {
    assert.equal(text(check(input)), '$\\sum_{k = 1}^{n}$');
  }
  // Nearby labels without the defining lower-limit relation remain separate.
  assert.equal(check([run('lim', 20, 30, 12, 17), run('x 2', 20, 37, 7, 17)]).events.length, 0);
});

test('verified integral symbols own both printed bounds, never nearby prose or another column', () => {
  const input = [run('∫', 20, 30, 20, 12), run('− 1', 29, 36, 7, 10), run('b', 34, 17, 7, 4)];
  for (const rows of variants(input)) assert.equal(text(check(rows)), '$\\int_{− 1}^{b}$');
  assert.equal(check(input, [{ x1: 33, x2: 33, y1: 0, y2: 60 }]).events.length, 0);
});

test('negative fractional exponents stay a single script instead of losing the fractional operand', () => {
  const input = [run('4', 20, 40, 11, 5.5), run('−', 25.6, 29.9, 7.5, 5.6),
    run('─', 33.4, 32.5, 7.5, 6, { mathRole: 'fractionBar' }),
    run('1', 34.5, 25.4, 7.5, 3.7), run('2', 34.5, 35.1, 7.5, 3.7)];
  for (const rows of variants(input)) assert.equal(text(check(rows)), '$4^{−\\frac{1}{2}}$');
});

test('braced sequence and closed function group retain their own ordinary scripts', () => {
  for (const rows of variants([run('{a', 20, 40, 13.5, 11, { sourceMathLatex: '\\{\\mathit{a}' }),
    run('n', 31.4, 41.6, 7.5, 4.5), run('}', 35.9, 40, 13.5, 6.4)])) {
    assert.equal(text(check(rows)), '$\\{\\mathit{a}_{n}\\}$');
  }
  assert.equal(text(check([run('f(x)=(ln x)', 20, 40, 11, 60), run('3', 80.4, 35.1, 7.5, 3.7)])), '$f(x)=(\\ln x)^{3}$');
});

test('cases preserve parenthesized Korean conditions and do not consume following prose', () => {
  const input = [run('⎧', 20, 30), run('⎨', 20, 50), run('⎩', 20, 70),
    run('5', 30, 35), run('x', 30, 65),
    prose('(', 64, 35, 4), run('x', 68, 35), prose('가 정수인 경우', 75, 35, 60), prose(')', 135, 35, 4),
    prose('(', 64, 65, 4), run('x', 68, 65), prose('가 정수가 아닌 경우', 75, 65, 85), prose(')', 160, 65, 4),
    prose('를 만족한다.', 30, 90, 50)];
  for (const rows of variants(input)) {
    const out = check(rows), equation = out.items.find(r => r.text.includes('cases')).text;
    assert.equal(equation, '$\\begin{cases}5&(x\\text{가 정수인 경우})\\\\x&(x\\text{가 정수가 아닌 경우})\\end{cases}$');
    assert.equal(out.items.find(r => r.text === '를 만족한다.').equation, false);
  }
});

test('upright operator font metadata becomes an operator rather than a nested font command', () => {
  assert.equal(text(check([run('sin x', 20, 40, 11, 30, { sourceMathLatex: '\\mathrm{sin} \\mathit{x}' })])), '$\\sin \\mathit{x}$');
});

test('a raised coefficient and radical stay together inside a fractional numerator exponent', () => {
  const input = [run('─', 20, 50, 11, 33, { mathRole: 'fractionBar' }), run('3', 35, 53.8, 11, 5.5),
    run('2e', 21.6, 39.3, 11, 10.4), run('2', 33.1, 34.4, 7.5, 3.7),
    run('√', 36.8, 33.9, 8.2, 7.44, { mathRole: 'radical' }),
    run('─', 44.2, 31.9, 7.5, 5, { mathRole: 'fractionBar' }), run('3', 44.4, 34.4, 7.5, 3.7)];
  for (const rows of variants(input)) assert.equal(text(check(rows)), '$\\frac{2e^{2\\sqrt{3}}}{3}$');
});

test('a printed small root index belongs to the radical crook, not to preceding math', () => {
  const input = [run('f', 10, 40, 11, 6), run('(', 17.4, 40.8, 14.8, 4.3),
    run('√', 21.1, 40.7, 13.8, 11, { mathRole: 'radical' }),
    run('─', 31.4, 36.4, 11, 7.1, { mathRole: 'fractionBar' }), run('x', 31.6, 40, 11, 5.7),
    run(')', 38.7, 40.8, 14.8, 4.3), run('3', 23.4, 35.7, 6, 3)];
  for (const rows of variants(input)) assert.match(text(check(rows)), /\\sqrt\[3\]\{x\}/);
  assert.doesNotMatch(text(check(input.filter(r => r.text !== '3'))), /\\sqrt\[/);
});

test('a full raised formula owns its fractional and trigonometric continuation', () => {
  const input = [run('2', 20, 50, 11, 5.5), run('2x +', 25.2, 40.76, 7.5, 16),
    run('─', 43.2, 43.04, 7.5, 6, { mathRole: 'fractionBar' }),
    run('1', 44.3, 35.9, 7.5, 3.7), run('2', 44.3, 45.62, 7.5, 3.7),
    run('cos πx', 49.5, 40.28, 7.5, 21, { sourceMathLatex: '\\mathrm{cos} πx' })];
  for (const rows of variants(input)) assert.equal(text(check(rows)), '$2^{2x +\\frac{1}{2}\\cos πx}$');
  const nested = [run('2', 20, 40, 11, 5.5), run('4g', 26.1, 35.1, 7.5, 7.3),
    run('(', 34.5, 34.8, 7.5, 2.9), run('x', 37.5, 35.1, 7.5, 4.2), run(')', 42, 34.8, 7.5, 2.9)];
  for (const rows of variants(nested)) assert.equal(text(check(rows)), '$2^{4g(x)}$');
});

test('a single slanted statistical variable accepts its painted overbar advance but never a fraction', () => {
  const input = [run('─', 20, 30, 11, 12.36, { mathRole: 'fractionBar' }),
    run('X', 20, 33.9, 11.61, 8.28, { sourceMathLatex: '\\mathit{X}' })];
  for (const rows of variants(input)) assert.equal(text(check(rows)), '$\\overline{\\mathit{X}}$');
  assert.equal(check([...input, run('1', 24, 19.2, 11, 5.5)]).events.filter(e => e.kind === 'overline').length, 0);
});

test('paired tall absolute-value delimiters preserve a complete expression and a lone separator stays literal', () => {
  for (const rows of variants([run('|', 20, 41, 15, 4), run('f(x)', 25, 40, 11, 23), run('|', 49, 41, 15, 4)])) {
    assert.equal(text(check(rows)), '$\\left|f(x)\\right|$');
  }
  assert.ok(check([run('t', 20, 40), run('|', 26, 41, 15, 4), run('t > 0', 31, 40, 11, 25)])
    .events.every(e => e.kind !== 'delimitedExpression'));
});

test('set-builder braces and their stretched separator retain the operands reading baseline', () => {
  const input = [run('{', 20, 42, 25.8, 6.4), run('t', 26.6, 38, 11, 4),
    run('|', 31.8, 42, 25.8, 5.45), run('t≥', 39.7, 38, 11, 19.2),
    run('─', 59.7, 41.4, 11, 8.8, { mathRole: 'fractionBar' }),
    run('2', 61.4, 45.2, 11, 5.5), run('3', 61.4, 30.6, 11, 5.5),
    run('}', 69.6, 42, 25.8, 6.4), prose('이다.', 77, 38, 20)];
  for (const rows of variants(input)) {
    const out = check(rows);
    assert.equal(text(out), '$\\left\\{t|t≥\\frac{3}{2}\\right\\}$ 이다.');
    const expected = rows.find(r => r.text === 't');
    assert.ok(Math.abs(out.items[0].baseline - expected.baseline) < expected.height * 0.02);
    assert.equal(out.items[0].height, expected.height);
  }
});

test('a printed prime follows its geometric label or derivative, never a remote label, row or cell', () => {
  const geometric = [run('FF', 20, 40, 11, 12, { sourceMathLatex: '\\mathrm{FF}' }),
    run('′', 32.1, 40.7, 11, 3, { equation: false }), prose('의 길이는?', 38, 40, 40)];
  for (const rows of variants(geometric)) assert.equal(text(check(rows)), "$\\mathrm{FF}'$ 의 길이는?");
  const derivative = [run('f', 20, 40, 11, 6), run('′', 26, 40.7, 11, 3, { equation: false }),
    run('(x)', 30, 40, 11, 13)];
  for (const rows of variants(derivative)) assert.equal(text(check(rows)), "$f'(x)$");
  const unchanged = result => assert.equal(result.items.find(r => r.text === '′')?.equation, false);
  unchanged(check(geometric.map(r => r.text === '′' ? { ...r, x: 55 } : r)));
  unchanged(check(geometric.map(r => r.text === '′' ? { ...r, y: 49, baseline: 60 } : r)));
  unchanged(check(geometric, [{ x1: 32.05, x2: 32.05, y1: 20, y2: 60 }]));
  unchanged(check(geometric.map(r => r.text === 'FF' ? { ...r, text: 'word', sourceMathLatex: undefined } : r)));
});

test('supplied math source: all pages retain audited compound scripts, operator bounds and valid formulas', {
  skip: !process.env.MUNHANG_MATH_0716_PDF,
}, async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { extractPositionedText } = require('../lib/pdf-text.ts');
  const { pdfRules } = require('../lib/pdf-structures.ts');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_MATH_0716_PDF)),
    fontExtraProperties: true, cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps/'), cMapPacked: true }).promise;
  const pages = [];
  try {
    assert.equal(pdf.numPages, 20);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n), transform = page.getViewport({ scale: 1 }).transform;
      const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const result = extractPositionedText(content.items, transform, ops, pdfjs.OPS, id => page.commonObjs.get(id), pdfRules(ops, pdfjs.OPS, transform));
      assert.equal(result.mathWarnings.length, 0, `unresolved structure on page ${n}`);
      for (const r of result.items) if (r.text.startsWith('$')) {
        assert.doesNotThrow(() => katex.renderToString(r.text.slice(1, -1), { throwOnError: true, strict: false }), `page ${n}: ${r.text}`);
      }
      pages.push(result.items.map(r => r.text).join(' ').replace(/\\(?:mathit|mathrm)\{([^{}]*)\}/g, '$1').replace(/\s+/g, ''));
    }
    assert.ok(pages[0].includes('2^{\\frac{3}{2}}×4^{−\\frac{1}{2}}'));
    assert.ok(pages[0].includes('\\lim_{x→2}'));
    assert.ok(pages[4].includes('\\sqrt[3]{k}'));
    assert.ok(pages[4].includes('\\left|f(x)\\right|'));
    assert.ok(pages[5].includes('\\left\\{t|t≥\\frac{3}{2}\\right\\}'));
    assert.ok(pages[9].includes('\\left(2x^{3}+\\frac{1}{x^{2}}\\right)^{4}'));
    assert.equal((pages[11].match(/\\overline\{X\}/g) ?? []).length, 2);
    assert.ok(pages[15].includes('2^{2x+\\frac{1}{2}\\cosπx}'));
    assert.ok(pages[15].includes('\\int_{f(1)}^{f(3)}'));
    assert.ok(pages[15].includes('\\int_{f(0)}^{f(2)}'));
    assert.ok(pages[15].includes('2^{4g(x)}'));
    assert.ok(pages[15].includes('a_{n}|≥10)'));
    assert.ok(pages[17].includes("FF'"));
    assert.ok(pages[19].includes("PF'"));
    assert.ok(pages[19].includes("AF'"));
    assert.ok(pages[19].includes("∠APF'"));
  } finally { await pdf.destroy(); }
});
