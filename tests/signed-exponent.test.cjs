/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const katex = require('katex');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');

const run = (text, x, baseline, height = 10, width = 5, extra = {}) => ({
  text, x, y: baseline - height, baseline, height, width, equation: true, ...extra,
});
const transform = (input, scale, dx = 0, dy = 0) => input.map((r) => ({
  ...r, x: r.x * scale + dx, y: r.y * scale + dy,
  baseline: r.baseline * scale + dy, width: r.width * scale, height: r.height * scale,
}));
const check = (input, rules = []) => {
  const original = JSON.stringify(input);
  const result = reconstructMathRuns(input, rules);
  assert.equal(result.sourceConserved, true);
  assert.equal(JSON.stringify(input), original);
  for (const item of result.items) {
    if (item.text.startsWith('$')) {
      assert.doesNotThrow(() => katex.renderToString(item.text.slice(1, -1), { throwOnError: true }));
    }
  }
  return result;
};
const textOf = (result) => result.items.map((r) => r.text).join('');

// Only the equation's recovered glyph geometry is recorded here; the source
// exam and embedded font stay on the user's computer.
const q17Equation = [
  run('1', 663.36, 860.28, 9.96, 4.98),
  run('.', 668.64, 859.68, 9.96, 2.74896),
  run('6', 671.64, 860.28, 9.96, 4.98),
  run('6', 676.92, 860.28, 9.96, 4.98),
  run('×', 683.52, 860.28, 9.96, 8.07756),
  run('1', 693.12, 860.28, 9.96, 4.98),
  run('0', 698.4, 860.28, 9.96, 4.98),
  run('−', 703.68, 855.48, 6.84, 4.986123924240001),
  run('2', 710.64, 855.72, 6.84, 3.3020688240000005),
  run('7', 714.36, 855.72, 6.84, 3.3020688240000005),
  run('k', 719.4, 859.68, 9.96, 5.38836),
  run('g', 725.4, 859.68, 9.96, 5.38836),
];

test('source q17 geometry reconstructs the whole signed exponent at every scale and input order', () => {
  for (const scale of [0.5, 0.75, 1, 2, 3]) {
    const atoms = transform(q17Equation, scale, -400, 125);
    for (const input of [atoms, [...atoms].reverse(), [...atoms.slice(5), ...atoms.slice(0, 5)]]) {
      const result = check(input);
      assert.equal(textOf(result), '$1.66×10^{−27}kg$');
      assert.equal(result.events.filter((r) => r.kind === 'rightScripts').length, 1);
      assert.equal(result.warnings.length, 0);
      assert.ok(result.items[0].sourceBounds.y <= Math.min(...input.map((r) => r.y)));
    }
  }
});

test('signed numerical and algebraic scripts stay on their anchored small-font row', () => {
  for (const sign of ['−', '-', '+']) {
    for (const digits of [['2', '7'], ['n', '+', '1']]) {
      const atoms = [run('10', 0, 30, 10, 10), run(sign, 10.3, 25.2, 6.8, 4.9)];
      digits.forEach((char, i) => atoms.push(run(char, 17.15 + i * 2.6, 25.4, 6.8, 2.4)));
      assert.equal(textOf(check(atoms)), `$10^{${sign}${digits.join('')}}$`);
    }
  }
});

test('an occupied slot cannot gain a duplicate power from the expanded base bounds', () => {
  // The detached digit is beyond the same-row gap limit but falls within the
  // second pass's base-sized gap limit after the minus has expanded the base.
  const atoms = [run('x', 0, 30), run('−', 5.3, 25.5, 6.8, 4.9), run('2', 12.7, 25.5, 6.8, 3.4)];
  for (const input of [atoms, [...atoms].reverse()]) {
    const result = check(input);
    assert.deepEqual(result.items.map((r) => r.text).sort(), ['$x^{−}$', '2']);
    assert.equal(result.events.filter((r) => r.kind === 'rightScripts').length, 1);
  }
});

test('nested powers and simultaneous upper/lower indices survive either source order', () => {
  const cases = [
    [[run('x', 0, 30), run('n', 5.3, 25.5, 6.8, 3.4), run('2', 8.9, 22.5, 4.6, 2.3)], '$x^{n^{2}}$'],
    [[run('x', 0, 30), run('2', 5.3, 25.5, 6.8, 3.4), run('i', 5.3, 33, 6.8, 3.4)], '$x^{2}_{i}$'],
    [[run('x', 0, 30), run('i', 5.3, 33, 6.8, 3.4), run('j', 8.9, 35.2, 4.6, 2.3)], '$x_{i_{j}}$'],
  ];
  for (const [atoms, expected] of cases) {
    for (const input of [atoms, atoms.toReversed()]) assert.equal(textOf(check(input)), expected);
  }
});

test('chemistry charges, molecular subscripts and nuclear left indices retain their roles', () => {
  const cases = [
    [[run('Y', 0, 30), run('2', 5.3, 25.5, 6.8, 3.3), run('−', 10.55, 25.5, 6.8, 4.9)], '$Y^{2−}$'],
    [[run('C', 0, 30), run('H', 5.2, 30), run('3', 10.4, 33, 6.8, 3.4), run('O', 14, 30), run('H', 19.2, 30)], '$CH_{3}OH$'],
    [[run('H', 20, 30), run('3', 16, 26.2, 6.8, 3.4), run('1', 16, 33, 6.8, 3.4)], '${}^{3}_{1}H$'],
  ];
  for (const [atoms, expected] of cases) {
    for (const input of [atoms, atoms.toReversed()]) assert.equal(textOf(check(input)), expected);
  }
});

test('cell borders, a different row and plain prose stop exponent continuation', () => {
  const atoms = [run('x', 0, 30), run('−', 5.3, 25.5, 6.8, 4.9), run('2', 12.15, 25.5, 6.8, 3.4)];
  const border = [{ x1: 11.2, y1: 10, x2: 11.2, y2: 40 }];
  const crossed = check(atoms, border);
  assert.deepEqual(crossed.items.map((r) => r.text).sort(), ['$x^{−}$', '2']);
  for (const last of [
    { ...atoms[2], baseline: 28, y: 21.2 },
    { ...atoms[2], equation: false },
  ]) {
    const result = check([...atoms.slice(0, 2), last]);
    assert.deepEqual(result.items.map((r) => r.text).sort(), ['$x^{−}$', '2']);
  }
});

// Optional end-to-end font decoding fixture. No PDF is bundled or downloaded.
test('provided physics PDF: page 4 decodes q17 as one signed power', {
  skip: !process.env.MUNHANG_SAMPLE_SIGNED_EXPONENT,
}, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_SAMPLE_SIGNED_EXPONENT)),
    fontExtraProperties: true,
  }).promise;
  try {
    const page = await pdf.getPage(4);
    const viewport = page.getViewport({ scale: 1 });
    const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
    const result = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS,
      (id) => page.commonObjs.get(id), rules);
    const equation = result.items.find((r) => r.text.includes('1.66'));
    assert.ok(equation);
    assert.equal(equation.text.replace(/\\mathrm\{([A-Za-z]+)\}/g, '$1'), '$1.66×10^{−27}kg$');
    assert.match(equation.text, /(?:\\mathrm\{kg\}|\\mathrm\{k\}\\mathrm\{g\})\$$/);
    assert.doesNotThrow(() => katex.renderToString(equation.text.slice(1, -1), { throwOnError: true }));
  } finally {
    await pdf.destroy();
  }
});
