/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractPositionedText, matchPositionedGlyph, countUnresolvedGlyphs,
  glyphOutlineFingerprint } = require('../lib/pdf-text.ts');
const { syntheticBoldAreas } = require('../lib/pdf-source-formatting.ts');

const item = (x, changes = {}) => ({ text: '\uf000', fontName: 'body', x,
  right: x + 5, baseline: 50, height: 10, ...changes });

test('same broken Unicode uses independently verified positioned evidence, never alternation or text order', () => {
  const evidence = [
    { ...item(20), replacement: '『' },
    { ...item(80), replacement: '』' },
    // A second opening mark is legitimate; paired punctuation is not inferred.
    { ...item(110), replacement: '『' },
  ];
  assert.deepEqual([110, 80, 20].map(x => matchPositionedGlyph(item(x), evidence)), ['『', '』', '『']);
  assert.equal(matchPositionedGlyph(item(50), evidence), undefined);
  assert.equal(matchPositionedGlyph(item(20, { text: '\ue000' }), evidence), undefined);
  assert.equal(matchPositionedGlyph(item(20, { fontName: 'another-font' }), evidence), undefined);
});

test('unknown, overlapping, mismatched and invalid glyph evidence remains unresolved', () => {
  const known = { ...item(20), replacement: '『' };
  for (const evidence of [[], [item(20)], [known, known],
    [known, { ...item(20), replacement: '』' }], [known, item(20)]]) {
    assert.equal(matchPositionedGlyph(item(20), evidence), undefined);
  }
  for (const changes of [{ x: 20.2 }, { right: 25.2 }, { baseline: 50.2 },
    { height: 10.2 }, { x: NaN }, { right: Infinity }]) {
    assert.equal(matchPositionedGlyph(item(20, changes), [known]), undefined);
  }
});

const ops = { setFont: 1, showText: 2, beginText: 3, setTextMatrix: 4 };
const viewport = [1, 0, 0, -1, 0, 100];
const operators = {
  fnArray: [1, 3, 4, 2, 4, 2],
  argsArray: [['body', 10], [], [1, 0, 0, 1, 20, 50],
    [[{ unicode: '\uf000', fontChar: '\ue001', width: 500 }]],
    [1, 0, 0, 1, 80, 50],
    [[{ unicode: '\uf000', fontChar: '\ue002', width: 500 }]]],
};
const textItems = [20, 80].map(x => ({ str: '\uf000', fontName: 'body',
  transform: [10, 0, 0, 10, x, 50], width: 5 }));

test('painted glyph metadata retains the distinct font characters behind one Unicode value', () => {
  const before = JSON.stringify(operators);
  const areas = syntheticBoldAreas(operators, ops, viewport, true);
  assert.deepEqual(areas.map(a => ({ font: a.fontName, glyphs: a.glyphs })), [
    { font: 'body', glyphs: [{ text: '\uf000', fontChar: '\ue001', x: 20, right: 25 }] },
    { font: 'body', glyphs: [{ text: '\uf000', fontChar: '\ue002', x: 80, right: 85 }] },
  ]);
  assert.equal(JSON.stringify(operators), before);
});

test('font name, source character code and paired positions alone do not repair unknown outlines', () => {
  for (const font of [undefined, { name: 'Haansoft Batang' },
    { name: 'ABCDEF+Haansoft Batang', data: new Uint8Array(100) },
    { name: 'UnknownFont', data: new Uint8Array(100) }]) {
    const result = extractPositionedText(textItems, viewport, operators, ops, () => font);
    assert.equal(result.recoveredGlyphs, 0);
    assert.equal(result.items.map(i => i.text).join(''), '\uf000\uf000');
    assert.equal(countUnresolvedGlyphs(result.items.map(i => i.text).join('')), 2);
  }
});

// Optional private integration: no PDF, embedded font or question wording is
// bundled. Only independently checked glyph fingerprints/geometry are asserted.
test('supplied history source: all six title marks recover, with unknown fonts and unmatched positions rejected',
  { skip: !process.env.MUNHANG_HISTORY_PDF }, async () => {
    if (process.env.CODEX_CANVAS_MODULE) {
      const canvas = require(process.env.CODEX_CANVAS_MODULE);
      global.DOMMatrix = canvas.DOMMatrix;
      global.ImageData = canvas.ImageData;
      global.Path2D = canvas.Path2D;
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_HISTORY_PDF)),
      fontExtraProperties: true, cMapUrl: path.join(base, 'cmaps') + path.sep,
      cMapPacked: true, standardFontDataUrl: path.join(base, 'standard_fonts') + path.sep,
    }).promise;
    const seen = new Set();
    let recovered = 0;
    try {
      assert.equal(pdf.numPages, 4);
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const [content, list] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        const view = page.getViewport({ scale: 1 }).transform;
        const getFont = id => page.commonObjs.get(id);
        const result = extractPositionedText(content.items, view, list, pdfjs.OPS, getFont);
        recovered += result.recoveredGlyphs;
        assert.equal(countUnresolvedGlyphs(result.items.map(i => i.text).join('')), 0);
        const marks = result.items.filter(i => /^[『』]$/.test(i.text));
        assert.deepEqual(marks.sort((a, b) => a.x - b.x).map(i => i.text), n < 4 ? ['『', '』'] : []);
        const reverse = extractPositionedText([...content.items].reverse(), view, list, pdfjs.OPS, getFont);
        assert.deepEqual(reverse.items.filter(i => /^[『』]$/.test(i.text)).sort((a, b) => a.x - b.x), marks);
        const affected = content.items.filter(i => i.str === '\uf000');
        assert.equal(affected.length, n < 4 ? 2 : 0);
        const unmatched = affected.map(i => ({ ...i, transform: [...i.transform.slice(0, 4), i.transform[4] + 10, i.transform[5]] }));
        for (const bad of [
          extractPositionedText(unmatched, view, list, pdfjs.OPS, getFont),
          extractPositionedText(affected, view, list, pdfjs.OPS, id => ({ ...getFont(id), name: 'UnknownFont' })),
          extractPositionedText(affected, view, list, pdfjs.OPS, id => ({ name: getFont(id).name })),
        ]) {
          assert.equal(bad.recoveredGlyphs, 0);
          assert.equal(countUnresolvedGlyphs(bad.items.map(i => i.text).join('')), affected.length);
        }
        for (const affectedItem of affected) {
          const font = getFont(affectedItem.fontName);
          for (const [source, unicode] of Object.entries(font.toUnicode?._map ?? {})) {
            if (unicode !== '\uf000') continue;
            const fp = glyphOutlineFingerprint(font.data, font.toFontChar[Number(source)]);
            assert.ok(['78:d81808e6:bdc8e6e2', '76:cc3b1cb9:225530f7'].includes(fp));
            seen.add(fp);
          }
        }
      }
      assert.equal(recovered, 6);
      assert.equal(seen.size, 2);
    } finally { await pdf.destroy(); }
  });
