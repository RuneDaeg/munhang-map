/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'),
  assert = require('node:assert/strict');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const {
  detectChoicePanels,
  detectDialogue,
} = require('../lib/pdf-reading-order.ts');
const { structureQuestionRegion } = require('../lib/pdf-structures.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const {
  pdfImageAreas,
  locateVisualChoices,
} = require('../lib/pdf-visual-choices.ts');
const {
  docxQuestionContent,
  hwpxQuestionContent,
} = require('../lib/table-export.ts');
const {
  preserveSourceStructures,
} = require('../lib/structure-completeness.ts');
const {
  questionStructures,
  questionPlainText,
} = require('../lib/question-content.ts');
const katex = require('katex');
const run = (text, x, baseline, height = 8, width = 4, extra = {}) => ({
  text,
  x,
  y: baseline - height,
  baseline,
  height,
  width,
  equation: true,
  ...extra,
});
const item = (text, x, y, width = 20) => ({ text, x, y, width, height: 8 });
const rule = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

test('duplicate vector strokes cannot fabricate extra text, and special math atoms are escaped', () => {
  const input = [run('a', 3, 17), run('b', 3, 27)];
  const r = reconstructMathRuns(input, [
    rule(0, 19, 12, 19),
    rule(0, 19, 12, 19),
  ]);
  assert.equal(r.sourceConserved, true);
  assert.equal(r.items.length, 1);
  assert.ok(!r.items[0].text.includes('─'));
  for (const char of ['$', '%', '&', '#']) {
    const out = reconstructMathRuns([
      run(char, 0, 30, 8, 4),
      run('x', 4.2, 30, 8, 4),
      run('2', 8.4, 27, 5.2, 3),
    ]);
    assert.equal(out.items.length, 1);
    assert.ok(out.items[0].text.includes('\\' + char));
    katex.renderToString(out.items[0].text.slice(1, -1), {
      throwOnError: true,
    });
  }
  const plain = reconstructMathRuns([run('5', 0, 30), run('%', 4.1, 30)]);
  assert.equal(plain.items[0].text, '5%');
});

test('fraction numerator and denominator are reconstructed within their own choice', () => {
  const input = [
    run('1', 21, 32),
    run('─', 20, 40, 8, 7, { mathRole: 'fractionBar' }),
    run('5', 21, 42.7),
    run('g', 28, 37.4),
  ];
  const r = reconstructMathRuns(input);
  assert.equal(r.sourceConserved, true);
  assert.equal(r.items.map((i) => i.text).join(''), String.raw`$\frac{1}{5}g$`);
  katex.renderToString(r.items[0].text.slice(1, -1), { throwOnError: true });
});
test('right scripts, left nuclides and chemical charges preserve baseline order', () => {
  for (const [input, expected] of [
    [[run('X', 10, 30), run('2', 14.2, 27, 5.2, 3)], '$X^{2}$'],
    [
      [run('H', 20, 30), run('3', 16, 27, 5.2, 3), run('1', 16, 32.5, 5.2, 3)],
      '${}^{3}_{1}H$',
    ],
    [
      [
        run('Y', 10, 30),
        run('2', 14.2, 27, 5.2, 3),
        run('−', 17.3, 27, 5.2, 3),
      ],
      '$Y^{2−}$',
    ],
  ]) {
    const r = reconstructMathRuns(input);
    assert.equal(r.sourceConserved, true);
    assert.equal(r.items[0].text, expected);
    katex.renderToString(expected.slice(1, -1), { throwOnError: true });
  }
});
test('orphan bars warn; table separators block cross-cell attachment; source remains immutable', () => {
  const input = [run('X', 0, 20, 8, 5), run('2', 5.8, 17, 5.3, 3)];
  const original = JSON.stringify(input);
  const r = reconstructMathRuns(input, [rule(5.5, 0, 5.5, 30)]);
  assert.deepEqual(r.items.map((i) => i.text).sort(), ['2', 'X']);
  assert.equal(JSON.stringify(input), original);
  const orphan = reconstructMathRuns([
    run('─', 0, 20, 8, 8, { mathRole: 'fractionBar' }),
  ]);
  assert.equal(orphan.items[0].text, '─');
  assert.equal(orphan.warnings.length, 1);
  const grid = reconstructMathRuns(
    [run('a', 3, 17), run('b', 3, 27)],
    [rule(0, 19, 12, 19), rule(0, 0, 0, 40)],
  );
  assert.equal(grid.events.length, 0);
});
test('tiny table alongside a paragraph is emitted after the complete paragraph', () => {
  const items = [
    item('표는', 10, 20, 30),
    item('자료를', 10, 32, 30),
    item('나타낸다.', 10, 44, 47),
    item('종류', 62, 20, 15),
    item('값', 92, 20, 8),
    item('A', 62, 34, 8),
    item('12', 92, 34, 12),
  ];
  const rules = [
    rule(60, 17, 60, 45),
    rule(87, 17, 87, 45),
    rule(113, 17, 113, 45),
    rule(60, 17, 113, 17),
    rule(60, 31, 113, 31),
    rule(60, 45, 113, 45),
  ];
  const r = structureQuestionRegion(items, rules, [0, 0, 1, 1], 130, 80);
  assert.ok(r.text.indexOf('나타낸다.') < r.text.indexOf(':::table'));
  assert.equal(questionStructures(r.text).length, 1);
  assert.match(r.text, /\| 종류 \| 값 \|/);
});
test('two-panel choice tables retain matching headings once and sort ① through ⑤', () => {
  const items = [];
  for (const [x, labels] of [
    [10, ['①', '③', '⑤']],
    [160, ['②', '④']],
  ]) {
    items.push(item('(가)', x + 25, 10, 15), item('(나)', x + 60, 10, 15));
    labels.forEach((label, i) =>
      items.push(
        item(label, x, 30 + i * 22, 8),
        item('A', x + 28, 30 + i * 22, 8),
        item('B', x + 65, 30 + i * 22, 8),
      ),
    );
  }
  const result = detectChoicePanels(items);
  assert.ok(result);
  assert.deepEqual(result.rows[0], ['', '(가)', '(나)']);
  assert.equal(
    result.rows
      .slice(1)
      .map((r) => r[0])
      .join(''),
    '①②③④⑤',
  );
  assert.equal(
    detectChoicePanels(items.filter((i) => i.text !== '⑤')),
    undefined,
  );
  assert.equal(
    detectChoicePanels(
      items.map((i) =>
        i.x > 160 && i.text === '(나)' ? { ...i, text: '(다)' } : i,
      ),
    ),
    undefined,
  );
  assert.deepEqual(detectDialogue(items), []);
});
test('nested tables export without source fences and survive the AI completeness guard', () => {
  const source =
    ':::box 실험 자료\n측정 전 설명\n:::table\n| 조건 | 값 |\n| --- | --- |\n| A | 12 |\n:::\n측정 후 설명\n:::';
  assert.equal(questionStructures(source).length, 2);
  assert.ok(!questionPlainText(source).includes(':::'));
  const docx = docxQuestionContent(source);
  assert.equal((docx.match(/<w:tbl>/g) || []).length, 2);
  assert.ok(docx.includes('w:w="9100"'));
  assert.ok(!docx.includes(':::'));
  let id = 1;
  const hwpx = hwpxQuestionContent(source, {
    paragraph: (t) => `<hp:p>${t}</hp:p>`,
    nextId: () => id++,
    border: 3,
    headerBorder: 4,
  });
  assert.equal((hwpx.match(/<hp:tbl /g) || []).length, 3);
  assert.ok(!hwpx.includes(':::'));
  const incomplete =
    ':::box 실험 자료\n측정 전 설명\n조건 값 A 12\n측정 후 설명\n:::';
  assert.equal(preserveSourceStructures(incomplete, source).text, source);
});
test('footer confirmation notices and vertical subject ribbons do not enter body geometry', () => {
  const items = [
    item('1. 다음 자료를 읽으시오.', 20, 100, 160),
    item('2. 다음 자료를 읽으시오.', 310, 100, 160),
    item('선택지 ① ② ③ ④ ⑤', 310, 690, 160),
    item('* 확인 사항', 310, 735, 80),
    item('답안지의 해당란에 기입하시오.', 310, 748, 160),
    ...['화', '학', 'Ⅰ'].map((text, i) => item(text, 570, 90 + i * 12, 7)),
  ];
  const page = layoutPage(items, 600, 800, 1);
  assert.ok(
    !page.bodyItems.some((i) => /답안지|확인 사항/.test(i.text) || i.x === 570),
  );
  const questions = locateQuestions([page]);
  assert.equal(questions.length, 2);
  assert.ok(!questions[1].text.includes('확인'));
  assert.equal(
    questions[0].regions[0].box[0] + questions[0].regions[0].box[2],
    0.5,
  );
});
test('visual choices use composed-page image bounds and refuse partial five-option sets', () => {
  const ops = { save: 1, transform: 2, paintImageXObject: 3, restore: 4 };
  const list = { fnArray: [], argsArray: [] },
    items = [];
  for (let i = 0; i < 5; i++) {
    list.fnArray.push(1, 2, 3, 4);
    list.argsArray.push([], [60, 0, 0, -30, 40, 45 + i * 50], ['grid'], []);
    items.push(item('①②③④⑤'[i], 25, 20 + i * 50, 8));
  }
  const images = pdfImageAreas(list, ops, [1, 0, 0, 1, 0, 0]);
  assert.equal(images.length, 5);
  assert.equal(images[0].y, 15);
  const choices = locateVisualChoices(items, images, [0, 0, 1, 1], 200, 300);
  assert.equal(choices.length, 5);
  assert.equal(choices.map((c) => c.label).join(''), '①②③④⑤');
  assert.ok(choices[0].box[0] < 0.2);
  assert.deepEqual(
    locateVisualChoices(items.slice(1), images, [0, 0, 1, 1], 200, 300),
    [],
  );
});

test('visual-choice white image padding cannot include the next row label', () => {
  const items = Array.from({ length: 5 }, (_, i) => item('①②③④⑤'[i], 25, 20 + i * 50, 8));
  const images = items.map((m, i) => ({ id: `graph-${i}`, x: 40, y: m.y - 2, width: 60, height: 51 }));
  const choices = locateVisualChoices(items, images, [0, 0, 1, 1], 200, 300);
  assert.equal(choices.length, 5);
  choices.slice(0, 4).forEach((choice, index) => {
    assert.ok((choice.box[1] + choice.box[3]) * 300 < items[index + 1].y);
    assert.ok(choice.box[3] * 300 > 45, 'do not arbitrarily shrink the actual graph');
  });
});
