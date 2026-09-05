/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const pdfRequire = createRequire(require.resolve('pdfjs-dist/package.json'));
const canvas = pdfRequire('@napi-rs/canvas');
const { analyzePdf } = require('../lib/pdf-analysis.ts');

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node tests/pdf-file-smoke.cjs /path/to/exam.pdf');
  global.DOMMatrix = canvas.DOMMatrix;
  global.ImageData = canvas.ImageData;
  global.Path2D = canvas.Path2D;
  global.Image = canvas.Image;
  global.document = { createElement: () => canvas.createCanvas(1, 1) };
  global.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  global.fetch = async (url) => {
    assert.equal(url, '/data/achievement-standards.csv');
    return new Response(fs.readFileSync(path.join(__dirname, '../public/data/achievement-standards.csv')));
  };
  const result = await analyzePdf(new File([fs.readFileSync(filename)], path.basename(filename)));
  assert.ok(result.questions.length > 0);
  assert.ok(result.questions.every((question) => question.questionCaptures.length > 0));
  const output = path.join(__dirname, '../work/capture-check');
  fs.mkdirSync(output, { recursive: true });
  // Diagnostic artifacts are local only; source PDFs never enter the repository.
  const sample = result.questions.slice(0, 6);
  for (const [index, question] of sample.entries()) {
    for (const [part, capture] of question.questionCaptures.entries()) fs.writeFileSync(path.join(output, `q${index + 1}-${part + 1}.jpg`), Buffer.from(capture.image.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(output, 'page1.jpg'), Buffer.from(sample[0].sourcePageImage.split(',')[1], 'base64'));
  console.log(JSON.stringify({ pages: result.pageCount, questions: result.questions.length, details: result.questions.map((question) => ({ number: question.number, page: question.type, subject: question.examSubject?.label, captures: question.questionCaptures.map((capture) => ({ page: capture.page, box: capture.box })), warning: question.captureWarning })), output }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
