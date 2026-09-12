/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  preserveSourceStructures,
} = require('../lib/structure-completeness.ts');
const {
  questionTextFromBlocks,
  questionStructures,
} = require('../lib/question-content.ts');

const table = (rows, header = true) =>
  questionTextFromBlocks([
    { kind: 'table', title: '', rows, header, text: '' },
  ]);
const valueTable = (value) =>
  table([
    ['조건', '측정값'],
    ['A', value],
    ['B', '25.9'],
  ]);
const preserved = (source, candidate) => {
  const result = preserveSourceStructures(candidate, source);
  assert.equal(result.text, source);
  assert.match(result.warning, /표 셀.*누락/);
};
const accepted = (source, candidate) => {
  assert.deepEqual(preserveSourceStructures(candidate, source), {
    text: candidate,
    warning: '',
  });
};

test('same-size tables cannot blank reliable numeric or textual body cells', () => {
  for (const source of ['30', '노란색', 'HCl(aq)', '30 mL']) {
    for (const blank of ['', '—', '$\\quad$', '<u></u>', '$\\mathrm{}$']) {
      preserved(valueTable(source), valueTable(blank));
    }
  }
});

test('deleting digits, a decimal point or a sign from a numeric cell falls back', () => {
  for (const [source, candidate] of [
    ['30', '3'],
    ['23.4', '23'],
    ['23.4', '234'],
    ['-30', '30'],
    ['4.003u', '4.03u'],
    ['30 mL', '$3\\,\\mathrm{mL}$'],
  ])
    preserved(valueTable(source), valueTable(candidate));
});

test('dropping a value, including a repeated value, from a combined cell falls back', () => {
  for (const [source, candidate] of [
    ['30 10', '30'],
    ['30 30', '30'],
    ['10 / 20 / 30', '10 / 30'],
    ['30mL', 'mL'],
    ['2CuO + C → 2Cu', 'CuO + C → 2Cu'],
    ['$\\frac{30}{10}$', '30'],
  ])
    preserved(valueTable(source), valueTable(candidate));
});

test('numeric values must survive in their own cells, not only somewhere in the table', () => {
  const original = table([
    ['시료', 'I', 'II'],
    ['부피', '30', '10'],
    ['온도', '23.4', '25.5'],
  ]);
  const candidate = table([
    ['시료', 'I', 'II'],
    ['부피', '', '30 10'],
    ['온도', '23.4', '25.5'],
  ]);
  preserved(original, candidate);
});

test('ordinary LaTeX, style tags, units, subscripts and equivalent numbers are allowed', () => {
  for (const [source, candidate] of [
    ['30 mL', '$30\\,\\mathrm{mL}$'],
    ['30', '<b><u>30</u></b>'],
    ['30', '$30\\hspace{0.2cm}$'],
    ['30.0', '30'],
    ['030', '30'],
    ['3e1', '30'],
    ['1,000', '$1000$'],
    ['１．６６', '1.66'],
    ['H₂O', '$\\mathrm{H}_{2}\\mathrm{O}$'],
    ['cm³', '$\\mathrm{cm}^{3}$'],
    ['23.4℃', '$23.4{}^\\circ\\mathrm{C}$'],
    ['1.66×10⁻²⁷kg', '$1.66\\times10^{-27}\\mathrm{kg}$'],
    ['1×10³', '1000'],
    ['0.001', '$1\\times10^{-3}$'],
    ['30 / 10', '$\\frac{30}{10}$'],
    ['α', '$\\alpha$'],
  ])
    accepted(valueTable(source), valueTable(candidate));
});

test('OCR substitutions, unit conversions, added content and unknown source glyphs remain repairable', () => {
  for (const [source, candidate] of [
    ['23.4', '23.9'],
    ['3O', '30'],
    ['l0', '10'],
    ['30 mL', '0.03 L'],
    ['30', '30 ± 1'],
    ['', '30'],
    ['—', '0'],
    ['\uE034\uE03D', '30'],
    ['3\uE03D', '30'],
    ['\uFFFD', '30'],
    ['\u{F0030}', '30'],
  ])
    accepted(valueTable(source), valueTable(candidate));
});

test('header style changes and PUA header recovery do not suppress reliable body-cell checks', () => {
  const source = table([
    ['혼합 용액', '\uE001', '온도(℃)'],
    ['A', '30', '23.4'],
  ]);
  const restored = table([
    ['<b>혼합 용액</b>', 'I', '$\\text{온도}({}^\\circ\\mathrm{C})$'],
    ['A', '$30$', '23.4'],
  ]);
  accepted(source, restored);
  preserved(source, restored.replace('| A | $30$ |', '| A |  |'));
});

test('tables without a marked header and tables nested in a box are checked', () => {
  preserved(
    table(
      [
        ['A', '30'],
        ['B', '10'],
      ],
      false,
    ),
    table(
      [
        ['A', '3'],
        ['B', '10'],
      ],
      false,
    ),
  );
  const wrap = (value) =>
    questionTextFromBlocks([
      {
        kind: 'box',
        title: '자료',
        rows: [],
        header: false,
        text:
          '같은 조건에서 측정한 자료를 이용하여 물음에 답하시오.\n' +
          valueTable(value),
      },
    ]);
  const source = wrap('30'),
    candidate = wrap('3');
  assert.equal(
    questionStructures(source).filter((b) => b.kind === 'table').length,
    1,
  );
  preserved(source, candidate);
});

test('a second source table with a deleted cell also triggers the existing whole-source fallback', () => {
  const first = table([
    ['구분', '값'],
    ['A', '12'],
  ]);
  preserved(first + '\n' + valueTable('30'), first + '\n' + valueTable('3'));
});

test('missing-header-only recovery still retains updated prose and the exact body', () => {
  const rows = [
    ['조건', '측정값'],
    ['A', '30'],
    ['B', '25.9'],
  ];
  const source = '원래 설명\n' + table(rows);
  const candidate = '수정된 설명\n' + table(rows.slice(1), false);
  const result = preserveSourceStructures(candidate, source);
  assert.equal(result.text, '수정된 설명\n' + table(rows));
  assert.match(result.warning, /표 머리글.*복원/);
});

test('nonempty prose corrections and inputs without structures are unchanged', () => {
  accepted(valueTable('노란샥'), valueTable('노란색'));
  accepted('원래 설명', '수정 설명');
});
