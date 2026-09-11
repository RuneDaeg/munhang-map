/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createCanvas } = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
const { captureExportSummary, createCaptureArchive, downloadCaptureArchive } = require('../lib/document-export.ts');
const canvas = createCanvas(12, 16);
canvas.getContext('2d').fillRect(2, 3, 5, 8);
const jpg = canvas.toDataURL('image/jpeg');
const png = canvas.toDataURL('image/png');
const capture = (image = jpg, page = 1) => ({ image, page, box: [0.1, 0.1, 0.4, 0.4] });
const question = (fields = {}) => ({ number: 1, type: 'test', text: 'PRIVATE_TEXT', standard: 'PRIVATE_STANDARD', standardCode: '[검증]', domain: '수학', confidence: 50, sourceFileName: '수학.pdf', questionCaptures: [capture()], ...fields });
function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = [];
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
    assert.equal(buffer.readUInt16LE(offset + 6) & 0x800, 0x800, 'UTF-8 names for Windows');
    files.push({ name, data: buffer.subarray(start, start + size) }); offset = start + size;
  }
  return files;
}

test('raw capture ZIP keeps every part, repeated images, page order and duplicate source/number separately', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  global.fetch = () => { throw new Error('Image export must not use the network'); };
  const questions = [question({ questionCaptures: [capture(), capture(png, 1), capture(jpg, 2)] }), question()];
  const before = JSON.stringify(questions), progress = [];
  const files = unzip(await createCaptureArchive('내 문제함', questions, (done, total) => progress.push([done, total])));
  assert.equal(files.length, 4);
  assert.equal(new Set(files.map(({ name }) => name)).size, 4);
  assert.deepEqual(files.map(({ name }) => name), ['001_수학_001번_01_1쪽.jpg', '001_수학_001번_02_1쪽.png', '001_수학_001번_03_2쪽.jpg', '002_수학_001번_01_1쪽.jpg']);
  [jpg, png, jpg, jpg].forEach((image, index) => assert.deepEqual(files[index].data, Buffer.from(image.split(',')[1], 'base64')));
  assert.deepEqual(progress, [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
  assert.equal(JSON.stringify(questions), before);
});

test('only questionCaptures are exported, never full pages, choice images, text, standards or keys', async () => {
  const bytes = await createCaptureArchive('検査', [question({ sourcePageImage: 'PRIVATE_PAGE', figureImage: 'PRIVATE_FIGURE', visualChoices: [capture('PRIVATE_CHOICE')], apiKey: 'PRIVATE_KEY' })]);
  assert.equal(unzip(bytes).length, 1);
  assert.doesNotMatch(Buffer.from(bytes).toString(), /PRIVATE_/);
});

test('absent and empty captures block the entire archive without fallback or silent skipping', async () => {
  await assert.rejects(createCaptureArchive('시험지', []), /선택/);
  for (const questionCaptures of [undefined, []]) {
    const questions = [question(), question({ number: 2, questionCaptures, figureImage: jpg, sourcePageImage: jpg })];
    const summary = captureExportSummary(questions);
    assert.equal(summary.imageCount, 1); assert.equal(summary.missing.length, 1);
    assert.match(summary.missingLabels, /선택 2 · 수학 2번/);
    await assert.rejects(createCaptureArchive('시험지', questions), /캡처가 없는 문항 1개.*2번/);
  }
});

test('capture warnings are counted and current captures are preserved rather than dropped', async () => {
  const questions = [question({ captureWarning: '경계 확인' }), question({ captureWarning: '경계 확인', captureReviewed: true })];
  assert.equal(captureExportSummary(questions).reviewCount, 1);
  assert.equal(unzip(await createCaptureArchive('시험지', questions)).length, 2);
});

test('invalid or remote image inputs fail with the affected question and part', async () => {
  for (const image of ['https://example.test/capture.jpg', 'file:///tmp/scan.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,!!!!', 'data:image/jpeg;base64,abc', 'data:image/jpeg;base64,/9j/2Q==', 'data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64'), png.replace('image/png', 'image/jpeg'), jpg.slice(0, -12)]) {
    await assert.rejects(createCaptureArchive('시험지', [question({ number: 23, questionCaptures: [capture(), capture(image)] })]), /23번의 2번째 캡처/);
  }
  await assert.rejects(createCaptureArchive('시험지', [question({ questionCaptures: [capture(jpg, -1)] })]), /1번째 캡처/);
  await assert.rejects(createCaptureArchive('시험지', [question({ number: NaN })]), /문항 번호/);
});

test('safe short basenames handle private paths, controls, Korean, reserved names and collisions', async () => {
  const names = ['../../private/CON.pdf', 'C:\\private\\NUL.pdf', '\u202e과목\n:?.pdf', '가'.repeat(200) + '.pdf', '가'.repeat(200) + '.pdf', '../...pdf'];
  const files = unzip(await createCaptureArchive('fallback.pdf', names.map((sourceFileName) => question({ sourceFileName }))));
  assert.equal(new Set(files.map(({ name }) => name)).size, names.length);
  for (const { name } of files) {
    assert.doesNotMatch(name, /[\\/:*?"<>|\x00-\x1f\u202e]|private|^\./);
    assert.ok(Buffer.byteLength(name) < 240);
    assert.match(name, /^\d{3}_.*_001번_01_1쪽\.jpg$/);
  }
});

test('capture limits are checked before decoding oversized image data', async () => {
  await assert.rejects(createCaptureArchive('시험지', [question({ questionCaptures: Array(1001).fill(capture()) })]), /1,000장/);
  // Stub only the size observation, not a huge memory allocation.
  const originalSlice = String.prototype.slice;
  try {
    String.prototype.slice = function (start, end) {
      if (String(this) === jpg && start === 'data:image/jpeg;base64,'.length && end === undefined) return { length: 200_000_004, endsWith: () => false };
      return originalSlice.call(this, start, end);
    };
    await assert.rejects(createCaptureArchive('시험지', [question()]), /150MB/);
  } finally { String.prototype.slice = originalSlice; }
});

test('download creates an image-only ZIP with a safe name and revokes its temporary URL', async (t) => {
  const previous = { document: global.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL, timeout: global.setTimeout };
  t.after(() => { global.document = previous.document; URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke; global.setTimeout = previous.timeout; });
  const anchor = { click() { this.clicked = true; } }; let blob, revoked;
  global.document = { createElement: (tag) => { assert.equal(tag, 'a'); return anchor; } };
  URL.createObjectURL = (value) => { blob = value; return 'blob:test'; };
  URL.revokeObjectURL = (value) => { revoked = value; };
  global.setTimeout = (fn) => { fn(); };
  await downloadCaptureArchive('C:\\private\\수학.pdf', [question()]);
  assert.equal(anchor.download, '수학_문항캡처.zip'); assert.equal(anchor.clicked, true); assert.equal(revoked, 'blob:test');
  assert.equal(blob.type, 'application/zip'); assert.equal(unzip(new Uint8Array(await blob.arrayBuffer())).length, 1);
});

test('shared dialog exposes images separately from grouping in both PDF and bank flows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/export-dialog.tsx'), 'utf8');
  assert.match(source, /캡처 이미지만 · ZIP/);
  assert.match(source, /format === 'images'\) await downloadCaptureArchive/);
  assert.match(source, /captures.missing.length > 0/);
  assert.match(source, /aria-live="polite"/);
  for (const file of ['app/page.tsx', 'components/question-bank.tsx']) assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /<ExportDialog/);
});
