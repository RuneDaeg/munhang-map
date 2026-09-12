/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectPdfStructures, structureQuestionRegion, pdfRules } = require('../lib/pdf-structures.ts');
const { inferPdfTextStyles } = require('../lib/pdf-source-formatting.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const { pdfImageAreas } = require('../lib/pdf-visual-choices.ts');
const item = (text, x, y, width = 25, height = 10) => ({ text, x, y, width, height });
const rule = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const grid = (xs, ys) => [...xs.map(x => rule(x, ys[0], x, ys.at(-1))), ...ys.map(y => rule(xs[0], y, xs.at(-1), y))];

test('identically tall independent tables keep their own rows, labels and white gutter', () => {
  const rules = [...grid([0, 100], [0, 20, 80]), ...grid([120, 160, 210], [0, 20, 40, 60, 80])];
  const items = [item('특징', 10, 4), item('첫 번째 특징', 10, 25, 75), item('두 번째 특징', 10, 45, 75),
    item('분류', 125, 4), item('개수', 175, 4),
    ...['A', 'B', 'C'].flatMap((v, i) => [item(v, 130, 25 + i * 20, 10), item(String(i), 180, 25 + i * 20, 10)]),
    item('(가)', 40, 83, 20), item('(나)', 155, 83, 20)];
  const result = detectPdfStructures(items, rules);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(s => s.rows[0]), [['특징'], ['분류', '개수']]);
  assert.deepEqual(result.map(s => s.title), ['(가)', '(나)']);
  const text = structureQuestionRegion(items, rules, [0, 0, 1, 1], 220, 110).text;
  assert.equal((text.match(/첫 번째 특징/g) || []).length, 1);
  assert.equal((text.match(/:::table/g) || []).length, 2);
});

test('merged-header interior separators do not create duplicate child tables', () => {
  const rules = [...grid([0, 60, 240], [0, 40, 60, 80]), ...[120, 180].map(x => rule(x, 20, x, 80)), rule(60, 20, 240, 20)];
  const items = [item('구분', 10, 10), item('공통 머리글', 100, 3, 65),
    ...['A', 'B', 'C'].map((v, i) => item(v, 70 + i * 60, 25, 10)),
    ...[0, 1].flatMap(r => [item('행', 10, 45 + r * 20), ...[1, 2, 3].map((v, c) => item(String(v + r), 70 + c * 60, 45 + r * 20, 10))])];
  const tables = detectPdfStructures(items, rules).filter(s => s.kind === 'table');
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].rows.slice(1), [['행', '1', '2', '3'], ['행', '2', '3', '4']]);
});

test('exact PDF glyph advances split a partial underline without changing its letters', () => {
  const ops = { setFont: 1, setTextMatrix: 2, showText: 3 };
  const list = { fnArray: [1, 2, 3], argsArray: [['F1', 10], [1, 0, 0, 1, 10, 20], [Array.from('가나다라', unicode => ({ unicode, width: 1000 }))]] };
  const original = { ...item('가나다라', 10, 10, 40), baseline: 20, fontName: 'F1' };
  const result = inferPdfTextStyles([original], [rule(10, 22, 30, 22)], list, ops, [1, 0, 0, 1, 0, 0], () => undefined);
  assert.deepEqual(result.map(i => [i.text, !!i.underline]), [['가나', true], ['다라', false]]);
  assert.equal(result.map(i => i.text).join(''), original.text);
  const unknown = inferPdfTextStyles([{ ...original, text: '다른문자' }], [rule(10, 22, 30, 22)], list, ops, [1, 0, 0, 1, 0, 0], () => undefined);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].underline, undefined);
});

test('picture cells get explicit source references, while genuinely empty cells remain empty', () => {
  const rules = grid([0, 50, 120], [0, 20, 60, 100]);
  const items = [item('번호', 10, 3), item('자료', 65, 3), item('A', 10, 30), item('B', 10, 70)];
  const table = detectPdfStructures(items, rules, [{ x: 60, y: 25, width: 50, height: 30 }])[0];
  assert.equal(table.rows[1][1], '[그림: 원문 캡처 참조]');
  assert.equal(table.rows[2][1], '');
});

test('closed answer boxes retain inline order and never box unbordered labels', () => {
  const rules = grid([70, 100], [10, 24]);
  const items = [item('값은', 30, 8, 30), item('A', 80, 8, 10), item('이다.', 110, 8, 30)];
  const result = structureQuestionRegion(items, rules, [0, 0, 1, 1], 180, 50);
  assert.equal(result.text, '값은 $\\boxed{A}$ 이다.');
  assert.doesNotMatch(structureQuestionRegion(items, [], [0, 0, 1, 1], 180, 50).text, /boxed/);
  const roman = items.map(i => i.text === 'A' ? { ...i, text: '$\\mathrm{A}$' } : i);
  assert.equal(structureQuestionRegion(roman, rules, [0, 0, 1, 1], 180, 50).text,
    '값은 $\\boxed{\\mathrm{A}}$ 이다.');
});

test('measured side-image captions wait for the adjacent sentence without removing labels', () => {
  const items = [item('그림은 자료를', 10, 10, 70), item('나타내고 각각', 10, 25, 70),
    item('(가)', 125, 29, 20), item('이 값에 해당한다.', 10, 40, 90), item('다음 물음은?', 10, 65, 90)];
  const result = structureQuestionRegion(items, [], [0, 0, 1, 1], 180, 100, [], [{ x: 110, y: 0, width: 50, height: 28 }]);
  assert.match(result.text, /각각\n이 값에 해당한다\.\n\(가\)\n다음/);
  assert.equal((result.text.match(/\(가\)/g) || []).length, 1);
  const unknown = structureQuestionRegion(items, [], [0, 0, 1, 1], 180, 100);
  assert.match(unknown.text, /각각\n\(가\)\n이 값/);
});

test('provided science PDFs: table ownership, complete paragraphs, underlines, answer boxes and ribbons', {
  skip: !process.env.MUNHANG_SCIENCE_AUDIT_DIR,
}, async () => {
  const directory = process.env.MUNHANG_SCIENCE_AUDIT_DIR;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documents = new Map(), pages = new Map();
  const getPage = async (exam, n) => {
    const key = `${exam}-${n}`;
    if (pages.has(key)) return pages.get(key);
    if (!documents.has(exam)) {
      const file = fs.readdirSync(directory).find(f => new RegExp(`^${String(exam).padStart(2, '0')} `).test(f) && f.endsWith('.pdf'));
      assert.ok(file, `Missing sample PDF ${exam}`);
      documents.set(exam, await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(directory, file))), fontExtraProperties: true,
        cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps/'), cMapPacked: true }).promise);
    }
    const page = await documents.get(exam).getPage(n), viewport = page.getViewport({ scale: 1 });
    const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
    const extracted = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS, id => page.commonObjs.get(id), rules);
    const layout = layoutPage(extracted.items, viewport.width, viewport.height, n);
    const images = pdfImageAreas(operators, pdfjs.OPS, viewport.transform);
    const value = { layout, rules, images, extracted };
    pages.set(key, value);
    return value;
  };
  const question = async (exam, p, n) => {
    const { layout, rules, images } = await getPage(exam, p);
    const q = locateQuestions([layout]).find(q => q.number === n);
    assert.ok(q, `Missing ${exam}/${n}`);
    return structureQuestionRegion(layout.bodyItems, rules, q.regions[0].box, layout.width, layout.height, [], images);
  };
  try {
    for (const exam of [3, 7]) {
      const q = await question(exam, 1, 5), tables = q.structures.filter(s => s.kind === 'table');
      assert.equal(tables.length, 2);
      assert.equal(tables[0].rows[0].length, 1);
      assert.equal(tables[1].rows[0].length, 2);
      assert.equal((q.text.match(exam === 3 ? /독립적으로 물질대사를/g : /ATP 가 사용된다/g) || []).length, 1);
      assert.equal((tables[0].rows[1][0].match(/<br>/g) || []).length, 2);
    }
    const cellCycle = (await question(3, 1, 3)).text;
    assert.match(cellCycle, /은 각각\n\$\\mathrm\{G\}_\{2\}\$/);
    assert.match(cellCycle, /하나이다\s*\.\n\( 가 \) \( 나 \)\n이에 대한/);
    assert.equal((await question(3, 4, 19)).structures.filter(s => s.kind === 'table').length, 1);
    const paired = (await question(7, 2, 10)).structures.filter(s => s.kind === 'table');
    assert.equal(paired.length, 2);
    assert.deepEqual(paired.map(t => t.rows[0].slice(1)), [['Ⅰ', 'Ⅱ'], ['Ⅲ', 'Ⅳ']]);
    const experiment = (await question(3, 2, 10)).text;
    assert.match(experiment, /확인\s+한다\s*\.\s*:::table/);
    assert.match(experiment, /:::\s*\( ○ : 일어남/);
    assert.match((await question(7, 1, 4)).text, /:::table[\s\S]*:::\s*이에 대한/);
    const captions = (await question(1, 1, 5)).text;
    assert.match(captions, /라켓으로 공을\s+친다\./);
    assert.match(captions, /충돌할 때\s+에어백이 펴진다\./);
    assert.match(captions, /활시위를 당겨\s+화살을 쏜다\./);
    assert.match((await question(3, 1, 1)).text, /<u>인슐린<\/u>/);
    const isotope = (await question(7, 3, 14)).text;
    assert.match(isotope, /<u>이산화 탄소<\/u>/);
    assert.match(isotope, /<u>표지된 물<\/u>/);
    assert.match(isotope, /<u>\$\{\}\^\{18\}\\mathrm\{O\}\$<\/u> <u>로<\/u>/);
    const earth = (await question(8, 1, 4)).text;
    assert.match(earth, /<u>결합<\/u>/);
    assert.match(earth.replace(/<\/u> <u>/g, ' '), /<u>큰 스타이로폼 공<\/u>/);
    assert.match(earth, /<u>규산염 사면체 모형 여러 개를<\/u>/);
    assert.doesNotMatch(earth, /\\frac/);
    assert.match(earth, /\[그림: 원문 캡처 참조\]/);
    assert.equal(((await question(8, 3, 11)).text.match(/\[그림: 원문 캡처 참조\]/g) || []).length, 4);
    assert.equal(((await question(5, 1, 2)).text.match(/\\boxed\{(?:\\mathrm\{)?[ABC]\}?\}/g) || []).length, 3);
    assert.match((await question(1, 1, 6)).text, /\\boxed\{\\text\{㉠\}\}\$ \$?\+ 3\.27/);
    assert.match((await question(2, 1, 3)).text, /\\boxed\{\\text\{㉠\}\}/);
    assert.equal((await question(2, 3, 14)).structures.filter(s => s.kind === 'box').length, 2);
    assert.equal((await question(6, 1, 5)).structures.filter(s => s.kind === 'box').length, 2);
    for (const exam of [2, 3, 4, 5, 6, 7, 8]) {
      const { layout } = await getPage(exam, 1);
      assert.ok(layout.headerText.includes(exam === 5 ? '물리학' : exam === 2 || exam === 6 ? '화학' : exam === 3 || exam === 7 ? '생명과학' : '지구과학'));
      assert.equal(layout.bodyItems.filter(i => i.x > layout.width * .91 && /^[가-힣ⅠⅡIV]{1,3}$/.test(i.text)).length, 0);
      assert.ok(layout.columns.at(-1).right < 775);
    }
  } finally {
    for (const pdf of documents.values()) await pdf.destroy();
  }
});
