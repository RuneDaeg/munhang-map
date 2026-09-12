/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  countUnresolvedGlyphs,
  glyphWarning,
  glyphOutlineFingerprint,
  extractPositionedText,
  joinEquationRuns,
} = require('../lib/pdf-text.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const {
  pdfRules,
  structureQuestionRegion,
} = require('../lib/pdf-structures.ts');
const {
  docxQuestionContent,
  hwpxQuestionContent,
} = require('../lib/table-export.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');

test('PUA, supplementary PUA and replacement glyphs warn even when rare; normal math stays valid', () => {
  assert.equal(countUnresolvedGlyphs('L 65.0 cm ① □ ■ μ ± × ÷ →'), 0);
  assert.equal(
    countUnresolvedGlyphs('\uE039\uF8FF\u{F0001}\u{100001}\uFFFD▤'),
    5,
  );
  assert.match(
    glyphWarning('긴 설명'.repeat(1000) + '\uE039'),
    /1개 문자를 복원하지/,
  );
  assert.equal(glyphWarning('65.0 cm'), '');
  assert.equal(countUnresolvedGlyphs('변성된 흔적(▨)'),0);
  assert.equal(countUnresolvedGlyphs('▤▤ cm'),2);
});

test('a missing or differently shaped font is never decoded just from its name or PUA code', () => {
  const ops = { setFont: 1, showText: 2 };
  const operators = {
    fnArray: [1, 2],
    argsArray: [['f1', 10], [[{ unicode: '\uE039', fontChar: '\uE002' }]]],
  };
  const items = [
    {
      str: '\uE039',
      fontName: 'f1',
      transform: [10, 0, 0, 10, 20, 50],
      width: 5,
    },
  ];
  for (const font of [
    undefined,
    { name: 'HyhwpEQ' },
    { name: 'AAAAAA+HyhwpEQ', data: new Uint8Array(80) },
    { name: 'CustomFont', data: new Uint8Array(80) },
  ]) {
    const result = extractPositionedText(
      items,
      [1, 0, 0, -1, 0, 100],
      operators,
      ops,
      () => font,
    );
    assert.equal(result.recoveredGlyphs, 0);
    assert.deepEqual(result.items, [
      { text: '\uE039', x: 20, y: 40, width: 5, height: 10 },
    ]);
  }
  assert.equal(glyphOutlineFingerprint(new Uint8Array(7), 0xe002), undefined);
});

const run = (text, x, changes = {}) => ({
  text,
  x,
  y: 40,
  width: 5,
  height: 10,
  fontName: 'equation',
  equation: true,
  baseline: 50,
  ...changes,
});
test('equation digits, raised decimal dots and split unit letters join without invented spaces', () => {
  const parts = [
    run('6', 20),
    run('5', 25.2),
    run('.', 30.4, { width: 2.7, y: 39.4, baseline: 49.4 }),
    run('0', 33.3),
    run('c', 38.5),
    run('m', 43.7),
  ];
  const input = JSON.stringify(parts);
  const result = joinEquationRuns(parts);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, '65.0cm');
  assert.equal(JSON.stringify(parts), input);
});

test('table borders, separate columns, baselines, font sizes and prose prevent numeric run joining', () => {
  for (const second of [
    run('7', 40),
    run('2', 25.2, { baseline: 44, y: 38, height: 6 }),
    run('5', 25.2, { fontName: 'other' }),
    run('5', 25.2, { equation: false }),
  ]) {
    assert.equal(joinEquationRuns([run('6', 20), second]).length, 2);
  }
  assert.equal(
    joinEquationRuns(
      [run('6', 20), run('7', 26)],
      [{ x1: 25.5, x2: 25.5, y1: 30, y2: 60 }],
    ).length,
    2,
  );
});

test('verified numeric table text survives native DOCX and HWPX serializers', () => {
  const text =
    '거리 L\n:::table\n| 측정 | 값 |\n| --- | --- |\n| A | 65.0cm |\n| B | 7502.1mm |\n:::';
  let id = 1;
  const outputs = [
    docxQuestionContent(text),
    hwpxQuestionContent(text, {
      paragraph: (text) => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`,
      nextId: () => id++,
      border: 3,
      headerBorder: 4,
    }),
  ];
  for (const xml of outputs) {
    assert.match(xml, /65\.0cm/);
    assert.match(xml, /7502\.1mm/);
    assert.match(xml, /거리 L/);
    assert.equal(countUnresolvedGlyphs(xml), 0);
  }
});

test('AI rereads cannot replace intact numbers with PUA or label unresolved text as enhanced', async (t) => {
  const before = global.fetch;
  t.after(() => {
    global.fetch = before;
  });
  const question = {
    number: 5,
    text: '거리는 L이고 측정값은 65.0 cm이다.',
    sourcePageImage: 'data:image/jpeg;base64,/9j/2Q==',
  };
  global.fetch = async () =>
    Response.json({
      questions: [
        {
          number: 5,
          latexText:
            '거리는 \uE00B이고 측정값은 \uE039\uE038\uE053\uE03D cm이다.',
        },
      ],
    });
  const bad = await enhanceQuestionsWithVision([question]);
  assert.equal(bad.questions[0].text, question.text);
  assert.equal(bad.questions[0].visionEnhanced, false);
  assert.match(bad.warnings.join(' '), /깨진 문자/);
  const broken = { ...question, text: '측정값은 \uE039 cm이다.' };
  global.fetch = async () =>
    Response.json({ questions: [{ number: 5, latexText: broken.text }] });
  const partial = await enhanceQuestionsWithVision([broken]);
  assert.equal(partial.questions[0].visionEnhanced, false);
  assert.match(partial.warnings.join(' '), /복원하지 못/);
  global.fetch = async () =>
    Response.json({
      questions: [{ number: 5, latexText: '측정값은 6 cm이다.' }],
    });
  const good = await enhanceQuestionsWithVision([broken]);
  assert.equal(good.questions[0].text, '측정값은 6 cm이다.');
  assert.equal(good.questions[0].visionEnhanced, true);
});

// Optional integration fixture stays on the user's computer; the PDF/font is
// neither bundled nor downloaded. Run with MUNHANG_SAMPLE_SCIENCE=/path/to/pdf.
test(
  'provided science PDF: glyph outlines recover q5 numbers and L before table construction',
  { skip: !process.env.MUNHANG_SAMPLE_SCIENCE },
  async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(process.env.MUNHANG_SAMPLE_SCIENCE)),
      fontExtraProperties: true,
    }).promise;
    try {
      const pages = [],
        sources = [];
      let recovered = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n),
          viewport = page.getViewport({ scale: 1 });
        const [content, operators] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList(),
        ]);
        const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
        const result = extractPositionedText(
          content.items,
          viewport.transform,
          operators,
          pdfjs.OPS,
          (id) => page.commonObjs.get(id),
          rules,
        );
        recovered += result.recoveredGlyphs;
        assert.equal(
          countUnresolvedGlyphs(result.items.map((i) => i.text).join('')),
          0,
        );
        pages.push(
          layoutPage(result.items, viewport.width, viewport.height, n),
        );
        sources.push({ items: result.items, rules });
        // Same names/codes, absent font outlines: conservative failure, not a guess.
        if (n === 1)
          assert.equal(
            extractPositionedText(
              content.items,
              viewport.transform,
              operators,
              pdfjs.OPS,
              (id) => ({ name: page.commonObjs.get(id).name }),
            ).recoveredGlyphs,
            0,
          );
      }
      const qs = locateQuestions(pages);
      assert.equal(qs.length, 25);
      assert.equal(recovered, 254);
      const q = qs.find((q) => q.number === 5),
        region = q.regions[0],
        page = pages[region.page - 1],
        source = sources[region.page - 1];
      const result = structureQuestionRegion(
        source.items,
        source.rules,
        region.box,
        page.width,
        page.height,
      );
      // Source-preserving upright/italic runs now use transparent math
      // wrappers. Remove only these exact letter styles inside simple inline
      // math; retain every digit, decimal point, sign and unit character.
      const sourceCharacters = (text) => text.replace(/\$([^$\n]+)\$/g, (whole, math) =>
        /^(?:[A-Za-z0-9.\s]|\\(?:mathrm|mathit)\{[A-Za-z]+\})+$/.test(math)
          ? math.replace(/\\(?:mathrm|mathit)\{([A-Za-z]+)\}/g, '$1')
          : whole);
      assert.match(sourceCharacters(result.text), /거리 L/);
      assert.deepEqual(
        result.structures
          .find((s) => s.kind === 'table')
          .rows.slice(1)
          .map((row) => row.slice(1).map(sourceCharacters)),
        [
          ['65.0cm', '7.2m', '780.0cm', '7502.1mm'],
          ['70.0cm', '8.0m', '770.0cm', '7502.1mm'],
          ['75.0cm', '6.5m', '750.0cm', '7502.1mm'],
        ],
      );
      // Native math can split a numeric quantity over adjacent m:t runs.
      // Compare their exact visible characters, not serialized XML adjacency.
      const exported = docxQuestionContent(result.text);
      const exportedCharacters = Array.from(exported.matchAll(/<(?:w|m):t\b[^>]*>([^<]*)<\/(?:w|m):t>/g), (match) => match[1]).join('');
      for (const value of ['65.0cm', '7.2m', '7502.1mm'])
        assert.ok(exportedCharacters.includes(value));
    } finally {
      await pdf.destroy();
    }
  },
);
