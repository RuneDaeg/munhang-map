/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const katex = require('katex');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const { latexToOmml } = require('../lib/docx-math.ts');
const { latexToHwpxEquation } = require('../lib/hwpx-math.ts');

const run = (text, x, baseline, height = 10, width = 5, extra = {}) => ({
  text, x, y: baseline - height, baseline, height, width, equation: true, ...extra,
});
const transform = (input, scale, dx = 0, dy = 0) => input.map(r => ({
  ...r, x: r.x * scale + dx, y: r.y * scale + dy,
  baseline: r.baseline * scale + dy, width: r.width * scale, height: r.height * scale,
}));
const check = (input, rules = []) => {
  const snapshot = JSON.stringify(input);
  const result = reconstructMathRuns(input, rules);
  assert.equal(result.sourceConserved, true);
  assert.equal(JSON.stringify(input), snapshot);
  for (const item of result.items) if (item.text.startsWith('$')) {
    assert.doesNotThrow(() => katex.renderToString(item.text.slice(1, -1), { throwOnError: true }));
  }
  return result;
};
const leftEvents = result => result.events.filter(event => event.kind === 'leftScripts');
const textOf = result => result.items.map(item => item.text).join('');

// The public regression stores only the source equation's numerical geometry,
// never the user's PDF or its embedded font. PDF.js grouped each element with
// its following operator; the six correctly positioned index pairs were lost.
const sourceRow = (second = false) => {
  const baseLine = second ? 924.4209 : 902.0409;
  const supLine = second ? 920.2809 : 897.8409;
  const subLine = second ? 928.0209 : 905.6409;
  return [
    run('1', 514.2599, subLine, 7.5, 3.72),
    run('2', 514.2599, supLine, 7.5, 3.72),
    run('H +', 518.04, baseLine, 10.98, 19.72848),
    run('1', 540.36, subLine, 7.5, 3.72),
    run('2', 540.36, supLine, 7.5, 3.72),
    run('H →', 544.08, baseLine, 10.98, 22.0248),
    run(second ? '1' : '2', 569.7, subLine, 7.5, 3.72),
    run('3', 569.7, supLine, 7.5, 3.72),
    run(second ? 'H +' : 'He +', 573.42, baseLine, 10.98, second ? 18.40368 : 24.40944),
  ];
};
const expectedRow = second => '${}^{2}_{1}H +{}^{2}_{1}H →{}^{3}_{' + (second ? '1}H' : '2}He') + ' +$';

test('actual grouped reaction runs retain all six prescripts across scale, translation and source order', () => {
  for (const scale of [0.5, 0.75, 1, 2, 3]) {
    const atoms = transform([...sourceRow(), ...sourceRow(true)], scale, -400, 125);
    for (const input of [atoms, atoms.toReversed(), [...atoms.slice(5), ...atoms.slice(0, 5)]]) {
      const result = check(input);
      assert.deepEqual(result.items.map(item => item.text), [expectedRow(false), expectedRow(true)]);
      assert.equal(leftEvents(result).length, 6);
      assert.equal(result.warnings.length, 0);
      for (const item of result.items) assert.ok(item.sourceBounds.height > item.height);
    }
  }
});

test('a leading element can share a run with a reaction operator without consuming it into the index', () => {
  for (const element of ['H', 'He', 'C', 'U']) for (const operator of ['', '+', ' +', ' →', '⇌', ' =']) {
    const atoms = [run(element + operator, 20, 30, 10, 20), run('3', 16, 26.2, 6.8, 3.4), run('1', 16, 33, 6.8, 3.4)];
    const result = check(atoms.map(r => ({ ...r, fontName: 'unrelated-font-name' })));
    assert.equal(textOf(result), '${}^{3}_{1}' + element + operator + '$');
    assert.equal(leftEvents(result).length, 1);
  }
  const digits = [run('C +', 24, 30, 10, 14), run('1', 16, 26.2, 6.8, 3.4), run('4', 19.6, 26.2, 6.8, 3.4), run('6', 19.6, 33, 6.8, 3.4)];
  assert.equal(textOf(check(digits)), '${}^{14}_{6}C +$');
});

test('coefficients, words, ordinary molecule prefixes and unpaired labels never become nuclei', () => {
  const pair = [run('2', 16, 26.2, 6.8, 3.4), run('1', 16, 33, 6.8, 3.4)];
  for (const baseText of ['2H +', 'H2 +', 'He said', 'H O', '+ H', 'ABC']) {
    assert.equal(leftEvents(check([run(baseText, 20, 30, 10, 20), ...pair])).length, 0, baseText);
  }
  for (const candidates of [pair.slice(0, 1), pair.slice(1), pair.map(r => ({ ...r, equation: false })),
    [run('2', 16, 30, 10, 3.4), pair[1]],
    [pair[0], { ...pair[1], x: 10 }],
    [...pair, run('7', 14, 23.2, 6.8, 3.4)]]) {
    assert.equal(leftEvents(check([run('H +', 20, 30, 10, 20), ...candidates])).length, 0);
  }
});

test('nearby right scripts and ionic charges retain their original side and atom', () => {
  const rightPair = [run('X', 0, 30), run('2', 5.3, 26.2, 6.8, 3.4), run('1', 5.3, 33, 6.8, 3.4), run('H +', 9.5, 30, 10, 15)];
  for (const atoms of [rightPair, rightPair.toReversed()]) {
    const result = check(atoms);
    assert.equal(leftEvents(result).length, 0);
    assert.equal(textOf(result), '$X^{2}_{1}H +$');
  }
  const molecular = check([run('H', 0, 30), run('2', 5.3, 33, 6.8, 3.4), run('O +', 9.5, 30, 10, 15)]);
  assert.equal(textOf(molecular), '$H_{2}O +$');
  assert.equal(leftEvents(molecular).length, 0);
  const charge = check([run('C', 0, 30), run('2', 5.3, 25.5, 6.8, 3.3), run('−', 10.55, 25.5, 6.8, 4.9), run('H +', 17, 30, 10, 15)]);
  assert.equal(textOf(charge), '$C^{2−}H +$');
  assert.equal(leftEvents(charge).length, 0);
  const chargedNucleus = check([run('C', 20, 30), run('14', 12.6, 26.2, 6.8, 6.8), run('6', 16, 33, 6.8, 3.4), run('+', 25.3, 25.5, 6.8, 3.4)]);
  assert.equal(textOf(chargedNucleus), '${}^{14}_{6}C^{+}$');
});

test('cell boundaries and fraction-operand ownership prevent false prescripts', () => {
  const atoms = [run('H +', 20, 30, 10, 20), run('2', 16, 26.2, 6.8, 3.4), run('1', 16, 33, 6.8, 3.4)];
  for (const rules of [
    [{ x1: 19.7, y1: 10, x2: 19.7, y2: 40 }],
    [{ x1: 10, y1: 24, x2: 50, y2: 24 }],
    [{ x1: 10, y1: 28, x2: 50, y2: 28 }],
  ]) {
    assert.equal(leftEvents(check(atoms, rules)).length, 0);
  }
  const fraction = run('─', 15.9, 31.9, 6.8, 3.7, { mathRole: 'fractionBar' });
  assert.equal(leftEvents(check([...atoms, fraction])).length, 0);
});

test('reconstructed prescripts survive KaTeX and native DOCX/HWPX equation serialization', () => {
  const result = check(sourceRow());
  const formula = result.items[0].text.slice(1, -1);
  const mathml = katex.renderToString(formula, { throwOnError: true, output: 'mathml' });
  assert.equal((mathml.match(/<msubsup><mrow><\/mrow>/g) || []).length, 3);
  const docx = latexToOmml(formula);
  const scripts = [...docx.matchAll(/<m:sPre>([\s\S]*?)<\/m:sPre>/g)].map(m => m[1]);
  assert.equal(scripts.length, 3);
  for (const [index, [sub, sup]] of [[1, 2], [1, 2], [2, 3]].entries()) {
    assert.match(scripts[index], new RegExp('<m:sub>[\\s\\S]*?>' + sub + '</m:t>[\\s\\S]*?</m:sub>'));
    assert.match(scripts[index], new RegExp('<m:sup>[\\s\\S]*?>' + sup + '</m:t>[\\s\\S]*?</m:sup>'));
    assert.doesNotMatch(scripts[index].match(/<m:e>([\s\S]*?)<\/m:e>/)[1], />[+→]</);
  }
  const hwpx = latexToHwpxEquation(formula, { id: 1 });
  assert.equal((hwpx.match(/LSUB/g) || []).length, 3);
  assert.equal((hwpx.match(/LSUP/g) || []).length, 3);
  assert.match(hwpx, /LSUB \{2\} LSUP \{3\}/);
  assert.match(hwpx, /rarrow/);
  assert.doesNotMatch(docx + hwpx, /\$|\\frac|<hp:pic|<w:drawing/);
});

test('provided physics I PDF: local glyph extraction recovers the six q6 left-index pairs', {
  skip: !process.env.MUNHANG_SAMPLE_PRESCRIPT,
}, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_SAMPLE_PRESCRIPT)), fontExtraProperties: true }).promise;
  try {
    const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
    const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
    const result = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS, id => page.commonObjs.get(id), rules);
    const question = locateQuestions([layoutPage(result.items, viewport.width, viewport.height, 1)]).find(q => q.number === 6);
    assert.ok(question);
    assert.equal((question.text.match(/\{\}\^\{2\}_\{1\}H/g) || []).length, 4);
    assert.match(question.text, /\{\}\^\{3\}_\{2\}He/);
    assert.match(question.text, /\{\}\^\{3\}_\{1\}H/);
    assert.doesNotMatch(question.text, /\n1 1 [12]/);
    assert.match(question.text, /3\.27 MeV/);
    assert.match(question.text, /4\.03 MeV/);
  } finally { await pdf.destroy(); }
});
