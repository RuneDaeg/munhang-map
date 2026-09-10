/* oxlint-disable typescript/no-require-imports */
// Local-only diagnostic. Reads the supplied PDFs, never calls an AI provider or saves their contents.
require('../tests/load-typescript.cjs');
const fs = require('node:fs'),
  path = require('node:path');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const {
  pdfRules,
  structureQuestionRegion,
} = require('../lib/pdf-structures.ts');
const { questionPlainText } = require('../lib/question-content.ts');
const {
  extractPositionedText,
  countUnresolvedGlyphs,
} = require('../lib/pdf-text.ts');

async function check(file, pdfjs) {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    fontExtraProperties: true,
  }).promise;
  try {
    let recoveredGlyphs = 0;
    const pages = [],
      sources = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n),
        viewport = page.getViewport({ scale: 1 });
      const [content, operators] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);
      const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
      const extracted = extractPositionedText(
        content.items,
        viewport.transform,
        operators,
        pdfjs.OPS,
        (id) => page.commonObjs.get(id),
        rules,
      );
      const items = extracted.items;
      recoveredGlyphs += extracted.recoveredGlyphs;
      const layout=layoutPage(items, viewport.width, viewport.height, n);
      pages.push(layout);
      sources.push({
        items:layout.bodyItems,
        rules,
      });
    }
    const questions = locateQuestions(pages),
      unresolvedQuestions = [],
      missingQuestions = [];
    let boxes = 0,
      tables = 0;
    for (const q of questions) {
      const result = q.regions.map((r) =>
        structureQuestionRegion(
          sources[r.page - 1].items,
          sources[r.page - 1].rules,
          r.box,
          pages[r.page - 1].width,
          pages[r.page - 1].height,
        ),
      );
      const output = questionPlainText(
        result
          .map((r) => r.text)
          .join('\n')
          .replace(new RegExp(`^\\s*${q.number}\\s*[.)]\\s*`), ''),
      );
      const counts = new Map();
      const unresolvedGlyphs = countUnresolvedGlyphs(output);
      if (unresolvedGlyphs)
        unresolvedQuestions.push({ number: q.number, unresolvedGlyphs });
      for (const char of output.replace(/[\s·]/g, ''))
        counts.set(char, (counts.get(char) || 0) + 1);
      let missing = 0;
      for (const char of q.text.replace(/[\s·]/g, '')) {
        if (counts.get(char)) counts.set(char, counts.get(char) - 1);
        else missing++;
      }
      if (missing)
        missingQuestions.push({ number: q.number, missingCharacters: missing });
      for (const r of result)
        for (const s of r.structures) {
          if (s.kind === 'box') boxes++;
          else tables++;
        }
    }
    console.log(
      JSON.stringify({
        file: path.basename(file),
        pages: pdf.numPages,
        questions: questions.length,
        boxes,
        tables,
        recoveredGlyphs,
        unresolvedQuestions,
        missingQuestions,
      }),
    );
    return (
      questions.length > 0 &&
      missingQuestions.length === 0 &&
      unresolvedQuestions.length === 0
    );
  } finally {
    await pdf.destroy();
  }
}
(async () => {
  const files = process.argv.slice(2);
  if (!files.length)
    throw new Error(
      'Usage: node scripts/check-pdf-structures.cjs /path/to/exam.pdf [...]',
    );
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const file of files)
    if (!(await check(file, pdfjs))) process.exitCode = 1;
  console.log(
    'Character conservation is not OCR, reading-order, or table-detection accuracy. Compare captures visually.',
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
