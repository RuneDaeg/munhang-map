/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { layoutPage, locateQuestions, measureColumnGutter } = require('../lib/pdf-layout.ts');

const row = (text, x, y, width = 180, height = 10) => ({ text, x, y, width, height });
function twoColumns() {
  return [row('1. 왼쪽 문항', 30, 90), row('2. 오른쪽 문항', 330, 90),
    ...Array.from({ length: 15 }, (_, i) => row('왼쪽 자료 문장', 30, 115 + i * 20)),
    ...Array.from({ length: 15 }, (_, i) => row('오른쪽 자료 문장', 330, 115 + i * 20)),
    row('① 보기 ② 보기 ③ 보기 ④ 보기 ⑤ 보기', 30, 710, 210),
    row('① 보기 ② 보기 ③ 보기 ④ 보기 ⑤ 보기', 330, 710, 210),
    row('1 4', 284, 745, 32)];
}

test('optional material evidence preserves the four-argument layout contract', () => {
  const items = twoColumns();
  assert.deepEqual(layoutPage(items, 600, 800, 1), layoutPage(items, 600, 800, 1, {}));
});

test('captures expand to observed raster margins and vector frame ends, not just text', () => {
  const items = twoColumns(), before = layoutPage(items, 600, 800, 1);
  const after = layoutPage(items, 600, 800, 1, {
    images: [{ x: 25, y: 110, width: 240, height: 100 }, { x: 325, y: 110, width: 265, height: 100 }],
    rules: [{ x1: 25, y1: 300, x2: 275, y2: 300 }],
  });
  assert.ok(after.columns[0].right >= 277);
  assert.ok(after.columns[1].right >= 592);
  assert.ok(after.columns[1].right > before.columns[1].right);
  assert.deepEqual(after.bodyItems, before.bodyItems, 'capture evidence must not rewrite/remove body text');
  assert.deepEqual(locateQuestions([after]).map(q => q.text), locateQuestions([before]).map(q => q.text));
});

test('full-page backgrounds, adjacent-column pictures, page dividers, and invalid boxes cannot bridge the gutter', () => {
  const items = twoColumns(), before = layoutPage(items, 600, 800, 1);
  const after = layoutPage(items, 600, 800, 1, {
    images: [
      { x: 0, y: 100, width: 600, height: 550 },
      { x: 250, y: 110, width: 150, height: 150 },
      { x: 585, y: 115, width: 15, height: 100 },
      { x: 300, y: 110, width: NaN, height: 100 },
      { x: 10, y: 20, width: 570, height: 50 },
    ],
    rules: [{ x1: 300, y1: 85, x2: 300, y2: 730 }, { x1: 0, y1: 500, x2: 600, y2: 500 }],
  });
  assert.deepEqual(after.columns, before.columns);
  const gutter = measureColumnGutter(items, 600, 800), middle = (gutter.left + gutter.right) / 2;
  assert.ok(after.columns[0].right < middle && after.columns[1].left > middle);
});

test('a painted separator inside an asymmetric text gutter is also a hard capture boundary', () => {
  const page = layoutPage(twoColumns(), 600, 800, 1, {
    images: [{ x: 25, y: 110, width: 256, height: 100 }],
    rules: [{ x1: 282, y1: 90, x2: 282, y2: 730 }],
  });
  assert.ok(page.columns[0].right >= 281 && page.columns[0].right <= 281.5,
    'include the complete image without its padding touching the printed divider');
});

const footerRules = [
  { x1: 265, y1: 740, x2: 335, y2: 740 },
  { x1: 265, y1: 768, x2: 335, y2: 768 },
  { x1: 263, y1: 742, x2: 263, y2: 766 },
  { x1: 337, y1: 742, x2: 337, y2: 766 },
];

test('rounded page-number frame is excluded before its top edge while all final choice glyphs remain', () => {
  const items = twoColumns(), before = layoutPage(items, 600, 800, 1);
  const after = layoutPage(items, 600, 800, 1, { rules: footerRules });
  assert.equal(after.columns[0].bottom, 739);
  assert.equal(after.columns[1].bottom, 739);
  assert.deepEqual(after.bodyItems, before.bodyItems);
  for (const q of locateQuestions([after])) {
    assert.match(q.text, /⑤/);
    const [, y, , h] = q.regions[0].box;
    assert.ok((y + h) * 800 > 721 && (y + h) * 800 < 740);
  }
});

test('a loose rule or a frame intersecting body glyphs cannot trim a capture', () => {
  const items = twoColumns();
  assert.equal(layoutPage(items, 600, 800, 1, { rules: footerRules.slice(0, 1) }).columns[0].bottom, 743);
  const overlapping = [...items, row('마지막 선택지의 긴 아래 부분', 30, 729, 180, 12)];
  assert.equal(layoutPage(overlapping, 600, 800, 1, { rules: footerRules }).columns[0].bottom, 743);
});

test('supplied history PDF: all material edges fit, without column bleed or page-number decoration', {
  skip: !process.env.MUNHANG_HISTORY_PDF,
}, async () => {
  const canvas = require(process.env.CODEX_CANVAS_MODULE || '@napi-rs/canvas');
  global.DOMMatrix = canvas.DOMMatrix; global.ImageData = canvas.ImageData; global.Path2D = canvas.Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { extractPositionedText } = require('../lib/pdf-text.ts');
  const { pdfRules } = require('../lib/pdf-structures.ts');
  const { pdfImageAreas } = require('../lib/pdf-visual-choices.ts');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_HISTORY_PDF)), fontExtraProperties: true }).promise;
  const pages = [], oldPages = [], geometries = [];
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p), viewport = page.getViewport({ scale: 1 });
      const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
      const images = pdfImageAreas(operators, pdfjs.OPS, viewport.transform);
      const decoded = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS, id => page.commonObjs.get(id), rules);
      oldPages.push(layoutPage(decoded.items, viewport.width, viewport.height, p));
      pages.push(layoutPage(decoded.items, viewport.width, viewport.height, p, { rules, images }));
      geometries.push({ rules, images });
    }
    const before = locateQuestions(oldPages), after = locateQuestions(pages);
    assert.deepEqual(after.map(q => q.number), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(after.map(q => q.text), before.map(q => q.text));
    const observedChanges = [];
    for (const q of after) {
      assert.equal(q.regions.length, 1);
      const page = pages[q.page - 1], old = before.find(a => a.number === q.number).regions[0].box;
      const [x, y, w, h] = q.regions[0].box.map((v, i) => v * (i % 2 ? page.height : page.width));
      if ((x + w) / page.width > old[0] + old[2] + 0.0001) observedChanges.push(q.number);
      const middle = page.width / 2;
      assert.ok(x + w < middle || x > middle, `q${q.number}: no adjacent column is included`);
      const ownedImages = geometries[q.page - 1].images.filter(a => a.y >= y && a.y + a.height <= y + h
        && a.width > 50 && a.height > 2 && a.x + a.width / 2 > x && a.x + a.width / 2 < x + w);
      for (const a of ownedImages) assert.ok(a.x >= x && a.x + a.width <= x + w, `q${q.number}: complete image margin`);
      const ownedBorders = geometries[q.page - 1].rules.filter(r => r.y1 > y && r.y2 < y + h
        && r.x2 - r.x1 > 150 && r.x2 - r.x1 < page.width / 2
        && (r.x1 + r.x2) / 2 > x && (r.x1 + r.x2) / 2 < x + w);
      for (const r of ownedBorders) assert.ok(r.x1 >= x && r.x2 <= x + w, `q${q.number}: complete vector border`);
      // The actual centered page-number frame begins at 1081.807pt on all four
      // supplied pages. This is source evidence in the fixture, never a crop preset.
      assert.ok(y + h < 1081.807, `q${q.number}: page-number outline excluded`);
    }
    for (const n of [2, 5, 6, 14, 15]) assert.ok(observedChanges.includes(n), `q${n}: previously clipped right edge expanded`);
  } finally { await pdf.destroy(); }
});
