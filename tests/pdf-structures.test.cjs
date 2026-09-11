/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  pdfRules,
  detectPdfStructures,
  detectChoiceTable,
  structureQuestionRegion,
} = require('../lib/pdf-structures.ts');
const {
  preserveSourceStructures,
} = require('../lib/structure-completeness.ts');
const item = (text, x, y, width = 25) => ({ text, x, y, width, height: 10 });
const rule = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

test('a blank box inside a first-row formula is not a merged-header column boundary',()=>{
  const rules=[rule(0,0,200,0),rule(0,40,200,40),rule(0,80,200,80),rule(0,0,0,80),rule(40,0,40,80),rule(200,0,200,80),rule(155,22,180,22),rule(155,37,180,37),rule(155,22,155,37),rule(180,22,180,37)];
  const source=[item('시험관',5,12,30),item('첫 행 설명',50,5,70),item('2CuO + C → 2Cu +',50,25,100),item('㉠',160,25,10),item('비커',5,55,30),item('둘째 행 설명',50,55,100)];
  const table=detectPdfStructures(source,rules).find(s=>s.kind==='table');
  assert.match(table.rows[0][1],/2CuO \+ C → 2Cu \+/);assert.match(table.rows[0][1],/㉠/);
});

test('painted rules respect transforms; clipping and unpainted rectangles are ignored', () => {
  const ops = {
    save: 1,
    restore: 2,
    transform: 3,
    constructPath: 4,
    moveTo: 5,
    lineTo: 6,
    rectangle: 7,
    stroke: 8,
    endPath: 9,
  };
  const rules = pdfRules(
    {
      fnArray: [1, 3, 4, 8, 2, 4, 9],
      argsArray: [
        [],
        [2, 0, 0, 2, 10, 20],
        [
          [5, 6],
          [0, 0, 100, 0],
        ],
        [],
        [],
        [[7], [0, 0, 400, 500]],
        [],
      ],
    },
    ops,
    [1, 0, 0, 1, 0, 0],
  );
  assert.deepEqual(rules, [rule(10, 20, 210, 20)]);
});
test('a split top border creates one view box and does not swallow outside choices', () => {
  const rules = [
    rule(20, 50, 20, 120),
    rule(320, 50, 320, 120),
    rule(20, 50, 145, 50),
    rule(185, 50, 320, 50),
    rule(20, 120, 320, 120),
  ];
  const items = [
    item('<보기>', 148, 43, 36),
    item('ㄱ. 관측 자료를 같은 조건에서 측정하여 기록하였다.', 30, 67, 230),
    item('ㄴ. 측정값을 비교하여 결과를 해석할 수 있다.', 30, 90, 225),
    item('① ㄱ ② ㄴ', 30, 130, 100),
  ];
  const result = structureQuestionRegion(items, rules, [0, 0, 1, 1], 350, 200);
  assert.equal(result.structures.length, 1);
  assert.equal(result.structures[0].title, '<보기>');
  assert.match(result.text, /:::\n①/);
  assert.equal((result.text.match(/관측 자료/g) || []).length, 1);
  assert.equal(detectPdfStructures([item('A B C', 40, 80)], rules).length, 0);
});
test('borderless choice table retains wide and multiline headers but excludes the score', () => {
  const items = [
    item('[1.5 점 ]', 250, 10, 55),
    item('조건이', 49, 27, 34),
    item('변하는 지역', 83, 27, 60),
    item('조건이 유지되는', 180, 27, 80),
    item('지역', 215, 39, 25),
    ...['①', '②', '③', '④', '⑤'].flatMap((label, i) => [
      item(label, 20, 55 + i * 18, 11),
      item('A', 95, 55 + i * 18, 8),
      item('B', 215, 55 + i * 18, 8),
    ]),
  ];
  const table = detectChoiceTable(items);
  assert.ok(table);
  assert.equal(table.rows.length, 6);
  assert.deepEqual(table.rows[0], [
    '',
    '조건이 변하는 지역',
    '조건이 유지되는 지역',
  ]);
  assert.ok(!JSON.stringify(table).includes('점'));
  assert.equal(detectChoiceTable(items.filter((i) => i.y >= 55)), undefined);
});
test('ruled grids preserve their first row and cannot turn into an empty diagram table', () => {
  const rules = [
    ...[20, 120, 220].map((x) => rule(x, 50, x, 140)),
    ...[50, 80, 110, 140].map((y) => rule(20, y, 220, y)),
  ];
  const items = [
    item('조건', 35, 60),
    item('측정값', 135, 60),
    item('A', 35, 90),
    item('12', 135, 90),
    item('B', 35, 120),
    item('24', 135, 120),
  ];
  const grid = detectPdfStructures(items, rules)[0];
  assert.equal(grid.kind, 'table');
  assert.deepEqual(grid.rows, [
    ['조건', '측정값'],
    ['A', '12'],
    ['B', '24'],
  ]);
});
test('merged heading retains leaf columns and associates its parent with each child', () => {
  const rules = [
    ...[20,120,220,320].map(x=>rule(x,20,x,140)),
    rule(170,40,170,140), rule(120,40,220,40),
    ...[20,60,100,140].map(y=>rule(20,y,320,y)),
  ];
  const items = [item('장소',40,35),item('주차율',145,23,50),item('평일',127,43),item('주말',180,43),item('소요 시간',240,35,65),
    item('공원',40,70),item('94%',127,70),item('98%',180,70),item('2분',240,70),
    item('구청',40,110),item('91%',127,110),item('13%',180,110),item('5분',240,110)];
  const grid=detectPdfStructures(items,rules).find(t=>t.x===20 && t.y===20);
  assert.deepEqual(grid.rows,[['장소','주차율 평일','주차율 주말','소요 시간'],['공원','94%','98%','2분'],['구청','91%','13%','5분']]);
});
test('single-character circled column labels are genuine choice headings', () => {
  for(const headings of [['㉠','㉡'],['ⓐ','ⓑ']]) {
    const items=[item(headings[0],90,20,10),item(headings[1],200,20,10),
      ...Array.from('①②③④⑤').flatMap((label,i)=>[item(label,20,40+i*20,10),item('가',90,40+i*20,10),item('나',200,40+i*20,10)])];
    assert.deepEqual(detectChoiceTable(items).rows[0],['',...headings]);
  }
});
test('a short boxed Korean phrase survives without promoting sparse diagram labels', () => {
  const rules=[rule(20,20,20,40),rule(100,20,100,40),rule(20,20,100,20),rule(20,40,100,40)];
  assert.equal(detectPdfStructures([item('옥패 한 쌍',27,25,60)],rules)[0].kind,'box');
  assert.equal(detectPdfStructures([item('A B C',27,25,60)],rules).length,0);
});
test('AI reread cannot discard boxes or table headers; a missing header alone is repaired', () => {
  const source =
    '설명\n:::table\n|  | 조건 A | 조건 B |\n| --- | --- | --- |\n| ① | X | Y |\n| ② | Y | X |\n:::';
  const missing = '새 설명\n:::table\n| ① | X | Y |\n| ② | Y | X |\n:::';
  const fixed = preserveSourceStructures(missing, source);
  assert.match(fixed.text, /새 설명/);
  assert.match(fixed.text, /조건 A/);
  assert.ok(fixed.warning);
  assert.equal(
    preserveSourceStructures('설명 ① X Y ② Y X', source).text,
    source,
  );
  const box =
    ':::box\n조건을 일정하게 유지하여 같은 길이를 여러 번 측정하였다.\n:::';
  assert.equal(
    preserveSourceStructures(
      '조건을 일정하게 유지하여 같은 길이를 여러 번 측정하였다.',
      box,
    ).text,
    box,
  );
});
test('short painted segments join into complete box sides', () => {
  const ops = { constructPath: 1, moveTo: 2, lineTo: 3, stroke: 4 };
  const fnArray = [],
    argsArray = [];
  const segments = [
    ...Array.from({ length: 6 }, (_, i) => [20, 50 + i * 12, 20, 62 + i * 12]),
    ...[
      rule(300, 50, 300, 122),
      rule(20, 50, 300, 50),
      rule(20, 122, 300, 122),
    ].map((r) => [r.x1, r.y1, r.x2, r.y2]),
  ];
  for (const points of segments) {
    fnArray.push(1, 4);
    argsArray.push([[2, 3], points], []);
  }
  const rules = pdfRules({ fnArray, argsArray }, ops, [1, 0, 0, 1, 0, 0]);
  assert.equal(
    detectPdfStructures(
      [
        item(
          'The students compare the observations and describe the results.',
          30,
          70,
          260,
        ),
      ],
      rules,
    ).length,
    1,
  );
});
test('open-sided price grid includes both outer headings and outside choice numbers', () => {
  const rules = [
    ...[80, 150, 240].map((x) => rule(x, 50, x, 170)),
    ...[50, 70, 90, 110, 130, 150, 170].map((y) => rule(30, y, 320, y)),
  ];
  const items = [
    item('Model', 35, 53, 35),
    item('Price', 95, 53),
    item('Output', 175, 53, 35),
    item('Color', 270, 53, 30),
    ...['①', '②', '③', '④', '⑤'].flatMap((s, i) => [
      item(s, 18, 72 + i * 20, 10),
      item('A', 45, 72 + i * 20, 8),
      item('$25', 95, 72 + i * 20, 20),
      item('45', 180, 72 + i * 20, 20),
      item('White', 270, 72 + i * 20, 30),
    ]),
  ];
  const result = structureQuestionRegion(items, rules, [0, 0, 1, 1], 350, 200);
  assert.deepEqual(result.structures[0].rows[0], [
    '',
    'Model',
    'Price',
    'Output',
    'Color',
  ]);
  assert.match(result.text, /\| ⑤ \| A \| \$25 \| 45 \| White \|/);
  assert.equal(result.structures.length, 1);
});
test('borderless English A/B matrix separates adjacent number labels and dot leaders', () => {
  const items = [
    item('(A)', 50, 35, 20),
    item('(B)', 145, 35, 20),
    ...['①', '②', '③', '④', '⑤'].flatMap((s, i) => [
      item(s, 20, 55 + i * 15, 10),
      item(
        ['short', 'longer', 'longest', 'brief', 'wide'][i],
        34,
        55 + i * 15,
        30 + i * 2,
      ),
      item('……', 100, 55 + i * 15, 18),
      item('result', 135, 55 + i * 15, 40),
    ]),
  ];
  const table = detectChoiceTable(items);
  assert.ok(table);
  assert.deepEqual(table.rows[0], ['', '(A)', '', '(B)']);
  assert.equal(table.rows[5][0], '⑤');
});
