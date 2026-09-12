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

function csvRows(data) {
  assert.deepEqual([...data.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const text = data.toString('utf8').replace(/^\uFEFF/, ''), rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && character === ',') { row.push(value); value = ''; }
    else if (!quoted && character === '\r' && text[i + 1] === '\n') { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += character;
  }
  assert.equal(quoted, false); assert.equal(value, ''); assert.deepEqual(row, []);
  return rows;
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

test('grouped captures reuse current code/domain across PDFs and preserve all duplicate parts and bytes', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  global.fetch = () => { throw new Error('Grouping must not read a model or use the network'); };
  const shared = question({ standardCode: '[12물리01-01]', domain: '물리학', standard: '원문 성취기준, "내용"\n두 번째 줄 $x_1$', sourceFileName: 'C:\\private\\첫 시험.pdf', questionCaptures: [capture(), capture(png, 3)], standardCandidates: [{ code: 'PRIVATE_CANDIDATE' }], sourcePageImage: 'PRIVATE_PAGE', figureImage: 'PRIVATE_FIGURE', apiKey: 'PRIVATE_KEY' });
  const questions = [shared, question({ sourceFileName: '/private/두 번째.pdf', standardCode: shared.standardCode, domain: shared.domain, standard: '사용자가 고른 성취기준' }), shared,
    question({ standardCode: shared.standardCode, domain: '다른 교과', standard: '교과가 다르면 별도 묶음' })];
  const before = JSON.stringify(questions), progress = [];
  const files = unzip(await createCaptureArchive('여러 시험지', questions, (done, total) => progress.push([done, total]), { groupByStandard: true }));
  const images = files.filter(({ name }) => name !== '문항목록.csv');
  assert.equal(images.length, 6); assert.equal(files.length, 7);
  assert.equal(new Set(images.map(({ name }) => name)).size, 6);
  const folder = images[0].name.split('/')[0];
  assert.ok(images.slice(0, 5).every(({ name }) => name.split('/')[0] === folder));
  assert.notEqual(images[5].name.split('/')[0], folder);
  assert.match(folder, /^\d{3}_\[12물리01-01\]_물리학$/);
  assert.match(images[3].name, /\/003_첫 시험_001번_01_1쪽.jpg$/);
  [jpg, png, jpg, jpg, png, jpg].forEach((image, index) => assert.deepEqual(images[index].data, Buffer.from(image.split(',')[1], 'base64')));
  const [header, ...rows] = csvRows(files.find(({ name }) => name === '문항목록.csv').data);
  assert.deepEqual(header, ['이미지 파일', '성취기준 코드', '성취기준 내용', '교과', '원본 PDF', '원본 문항 번호', '캡처 순번', '원본 쪽']);
  assert.deepEqual(rows.map((row) => row[0]), images.map(({ name }) => name));
  assert.deepEqual(rows.map((row) => row.slice(5)), [['1', '1', '1'], ['1', '2', '3'], ['1', '1', '1'], ['1', '1', '1'], ['1', '2', '3'], ['1', '1', '1']]);
  assert.equal(rows[0][2], shared.standard); assert.equal(rows[2][2], questions[1].standard);
  assert.equal(rows[0][4], '첫 시험.pdf'); assert.equal(rows[2][4], '두 번째.pdf');
  assert.doesNotMatch(Buffer.from(files.find(({ name }) => name === '문항목록.csv').data).toString('utf8'), /PRIVATE_|private|C:\\/);
  assert.deepEqual(progress, Array.from({ length: 7 }, (_, index) => [index, 6]));
  assert.equal(JSON.stringify(questions), before);
});

test('grouping retains unclassified captures and uses the current selection rather than recommendations', async () => {
  const selected = question({ standardCode: '[수정한 코드]', standard: '선택한 전문', standardCandidates: [{ code: '[후보 코드]', standard: '후보 전문' }] });
  const unclassified = question({ number: 7, standardCode: '  ', standard: '', domain: '임시 교과' });
  Object.freeze(selected.questionCaptures); Object.freeze(selected); Object.freeze(unclassified);
  const questions = Object.freeze([selected, unclassified]);
  const files = unzip(await createCaptureArchive('파일명.pdf', questions, undefined, { groupByStandard: true }));
  assert.match(files[1].name, /^\d{3}_미분류_분류 확인 필요\//);
  const [, first, missing] = csvRows(files.find(({ name }) => name === '문항목록.csv').data);
  assert.deepEqual(first.slice(1, 4), ['[수정한 코드]', '선택한 전문', '수학']);
  assert.deepEqual(missing.slice(1, 4), ['미분류', '', '임시 교과']);
  assert.doesNotMatch(Buffer.from(files.at(-1).data).toString('utf8'), /후보/);
});

test('group paths are safe and collision-proof while CSV quotes and neutralizes untrusted metadata', async () => {
  const formulas = ['=1+1', '  +SUM(1,2)', '\n\t@SUM(1,2)', ' -2+3', '\tanything', '\u200b=1+1', '\u061c=1+1', 'ordinary, "quoted"\nsecond line'];
  const questions = formulas.map((standard, index) => question({
    standard, standardCode: index < 2 ? '../CON/' + '\u202e가'.repeat(90) + index : '  =DANGEROUS',
    domain: '\u061cNUL\\aux:*?"<>|\t\u200e', sourceFileName: index === 0 ? 'C:\\private\\  +SUM(1,2).pdf' : '../private/\u202eCON.pdf',
  }));
  const files = unzip(await createCaptureArchive('..\\private\\fallback.pdf', questions, undefined, { groupByStandard: true }));
  const images = files.filter(({ name }) => name !== '문항목록.csv');
  assert.equal(new Set(images.map(({ name }) => name)).size, questions.length);
  const folders = new Set(images.map(({ name }) => name.split('/')[0]));
  assert.equal(folders.size, 3, 'different long codes survive truncation as distinct numbered folders');
  for (const { name } of images) {
    const components = name.split('/'); assert.equal(components.length, 2);
    for (const component of components) {
      assert.match(component, /^\d{3}_/);
      assert.doesNotMatch(component, /[\\/:*?"<>|\p{Cc}\p{Cf}]|^\.+$|[. ]$/u);
    }
  }
  const [, ...rows] = csvRows(files.at(-1).data);
  assert.deepEqual(rows.map((row) => row[2]), formulas.map((value, index) => index < formulas.length - 1 ? "'" + value : value));
  assert.equal(rows[0][4], "'  +SUM(1,2).pdf");
  assert.ok(rows.slice(2).every((row) => row[1] === "'=DANGEROUS"));
  assert.ok(rows.every((row) => !row[4].includes('private')));
});

test('flat capture default remains identical when grouping is explicitly disabled', async () => {
  const questions = [question({ standardCode: 'MUST_NOT_EXPORT_CODE', standard: 'MUST_NOT_EXPORT_STANDARD' })];
  const original = await createCaptureArchive('시험지', questions);
  assert.deepEqual(await createCaptureArchive('시험지', questions, undefined, { groupByStandard: false }), original);
  assert.deepEqual(await createCaptureArchive('시험지', questions, undefined, {}), original);
  assert.doesNotMatch(Buffer.from(original).toString('utf8'), /MUST_NOT_EXPORT|문항목록.csv/);
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

test('grouped export caps combined image and mapping bytes and still fails whole on missing/bad captures', async () => {
  await assert.rejects(createCaptureArchive('시험지', [question({ questionCaptures: Array(1001).fill(capture()) })], undefined, { groupByStandard: true }), /1,000장/);
  await assert.rejects(createCaptureArchive('시험지', [question(), question({ number: 2, questionCaptures: [] })], undefined, { groupByStandard: true }), /캡처가 없는 문항 1개/);
  await assert.rejects(createCaptureArchive('시험지', [question(), question({ number: 2, questionCaptures: [capture('https://example.test/scan.png')] })], undefined, { groupByStandard: true }), /2번의 1번째 캡처/);
  const originalEncode = Object.getOwnPropertyDescriptor(TextEncoder.prototype, 'encode');
  try {
    // Emulate a large metadata row without allocating a 150MB string/buffer.
    TextEncoder.prototype.encode = function (input) {
      if (String(input).includes('OVERSIZED_MAPPING')) return { length: 149_999_950 };
      return originalEncode.value.call(this, input);
    };
    await assert.rejects(createCaptureArchive('시험지', [question({ standard: 'OVERSIZED_MAPPING' })], undefined, { groupByStandard: true }), /이미지와 매핑 목록이 150MB/);
  } finally { Object.defineProperty(TextEncoder.prototype, 'encode', originalEncode); }
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
  await downloadCaptureArchive('C:\\private\\수학.pdf', [question()], undefined, { groupByStandard: true });
  assert.equal(anchor.download, '수학_성취기준별_문항캡처.zip'); assert.equal(revoked, 'blob:test');
  const grouped = unzip(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(grouped.length, 2); assert.equal(grouped.at(-1).name, '문항목록.csv');
});

test('shared dialog exposes images separately from grouping in both PDF and bank flows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/export-dialog.tsx'), 'utf8');
  assert.match(source, /캡처 이미지만 · ZIP/);
  assert.match(source, /format === 'images'\) await downloadCaptureArchive/);
  assert.match(source, /captures.missing.length > 0/);
  assert.match(source, /aria-live="polite"/);
  for (const file of ['app/page.tsx', 'components/question-bank.tsx']) assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /<ExportDialog/);
});
