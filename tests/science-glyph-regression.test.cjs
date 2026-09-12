/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  countUnresolvedGlyphs,
  extractPositionedText,
  glyphOutlineFingerprint,
} = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');

// Fingerprints and semantic expectations only. The original exam PDFs and
// embedded fonts stay outside the repository and distribution.
const verified = new Map([
  [0xe003, ['D', '268:7153a6b8:e73725f0']],
  [0xe007, ['H', '386:59265a18:38c60f06']],
  [0xe008, ['I', '194:9dd03ed1:1c40f239']],
  [0xe00a, ['K', '372:aee0b616:3c566050']],
  [0xe00c, ['M', '320:4e1fad7d:a629c1cf']],
  [0xe00f, ['P', '300:d0297d58:c85afc52']],
  [0xe010, ['Q', '472:8dca3b8c:64972b5a']],
  [0xe049, ['[', '52:e699f21e:71de6b8e']],
  [0xe04a, [']', '50:55acdae3:ba577353']],
  [0xe06e, ['→', '150:cafef31:ac4184cb']],
  [0xe088, ['Δ', '94:428858e7:be30fc67']],
  [0xe099, ['Φ', '438:13d546b5:70287bcf']],
  [0xe09e, ['β', '430:e2ac64e5:b07828eb']],
  [0xe09f, ['γ', '288:f35ddafd:f38cffc3']],
  [0xe0a0, ['δ', '338:a4ee5ce1:7748f601']],
  [0xe0a7, ['λ', '168:71d1d16a:2acaa4c']],
  [0xe0ad, ['ρ', '234:7880c6ed:ab830c3f']],
  [0xe10e, ['ε', '236:127681cc:9abbef34']],
]);

function decodeOne(unicode, fontChar, font) {
  return extractPositionedText(
    [{ str: unicode, fontName: 'f1', transform: [10, 0, 0, 10, 20, 50], width: 6 }],
    [1, 0, 0, -1, 0, 100],
    { fnArray: [1, 2], argsArray: [['f1', 10], [[{ unicode, fontChar }]]] },
    { setFont: 1, showText: 2 },
    () => font,
  );
}

test('new science PUA mappings still require verified embedded outlines', () => {
  for (const code of verified.keys()) {
    const unicode = String.fromCodePoint(code);
    for (const font of [
      undefined,
      { name: 'HyhwpEQ' },
      { name: 'ABCDEF+HyhwpEQ', data: new Uint8Array(100) },
      { name: 'UnknownFont', data: new Uint8Array(100) },
    ]) {
      const result = decodeOne(unicode, '\ue001', font);
      assert.equal(result.recoveredGlyphs, 0);
      assert.equal(result.items.map((item) => item.text).join(''), unicode);
      assert.equal(countUnresolvedGlyphs(result.items[0].text), 1);
    }
  }
});

// Run explicitly with MUNHANG_SCIENCE_AUDIT_DIR=/path/to/the/eight/science/PDFs.
// No fixture download, network call, font copy, or paid model request is used.
test(
  'eight supplied science PDFs: every verified symbol restores and unknown/conflicting fonts remain unresolved',
  { skip: !process.env.MUNHANG_SCIENCE_AUDIT_DIR },
  async () => {
    if (process.env.CODEX_CANVAS_MODULE) {
      const canvas = require(process.env.CODEX_CANVAS_MODULE);
      global.DOMMatrix = canvas.DOMMatrix;
      global.ImageData = canvas.ImageData;
      global.Path2D = canvas.Path2D;
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const directory = process.env.MUNHANG_SCIENCE_AUDIT_DIR;
    const files = fs.readdirSync(directory)
      .filter((name) => /^0[1-8]\s.*\.pdf$/iu.test(name))
      .sort();
    assert.equal(files.length, 8, 'Provide the exact eight-file science audit directory');
    const seen = new Set();
    let affectedGlyphs = 0;
    for (const file of files) {
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(fs.readFileSync(path.join(directory, file))),
        fontExtraProperties: true,
        cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps') + path.sep,
        cMapPacked: true,
        standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
      }).promise;
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
          const viewport = page.getViewport({ scale: 1 });
          const result = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS,
            (id) => page.commonObjs.get(id), pdfRules(operators, pdfjs.OPS, viewport.transform));
          assert.equal(countUnresolvedGlyphs(result.items.map((item) => item.text).join('')), 0,
            `${file}, page ${n}: private-use symbols must not survive`);
          for (const item of content.items) {
            if (!item.fontName || !item.str) continue;
            const font = page.commonObjs.get(item.fontName);
            for (const unicode of item.str) {
              const expected = verified.get(unicode.codePointAt(0));
              if (!expected) continue;
              affectedGlyphs++;
              if (seen.has(unicode)) continue;
              const source = Object.entries(font.toUnicode?._map ?? {}).find(([, value]) => value === unicode);
              assert.ok(source);
              const fontChar = String.fromCodePoint(font.toFontChar[Number(source[0])]);
              assert.equal(glyphOutlineFingerprint(font.data, fontChar.codePointAt(0)), expected[1]);
              const decoded = decodeOne(unicode, fontChar, font);
              assert.equal(decoded.recoveredGlyphs, 1);
              const displayed = decoded.items.map((run) => run.text).join('');
              // A verified upright/italic source glyph may now be wrapped in
              // transparent math styling. Permit only one literal glyph, so
              // semantic substitutions or extra text still fail this check.
              const semantic = displayed.replace(/^\$(?:\\mathrm|\\mathit)\{([^{}\\$])\}\$$/u, '$1');
              assert.equal(semantic, expected[0]);
              // Reusing a known glyph outline as another semantic PUA must fail.
              const falseUnicode = unicode === '\ue003' ? '\ue007' : '\ue003';
              assert.equal(decodeOne(falseUnicode, fontChar, font).recoveredGlyphs, 0);
              assert.equal(decodeOne(unicode, fontChar, { ...font, name: 'UnknownFont' }).recoveredGlyphs, 0);
              seen.add(unicode);
            }
          }
        }
      } finally {
        await pdf.destroy();
      }
    }
    assert.equal(seen.size, 18);
    assert.equal(affectedGlyphs, 104);
  },
);
