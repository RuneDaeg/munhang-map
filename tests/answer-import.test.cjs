/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createRequire } = require('node:module');
const { deflateRawSync } = require('node:zlib');
const { readAnswerFile } = require('../lib/answer-import.ts');

const pairs = result => result.entries.map(entry => [entry.number, entry.value]);
function noNetwork(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args);
    throw new Error('Answer imports must not use the network.');
  });
  t.after(() => assert.equal(calls.length, 0, 'The file reader made a network request.'));
}

// Synthetic ZIP32 packages are generated in memory. No private source document
// or answer fixture is read, written, or included in these regression tests.
function zip(entries) {
  const locals = [], directory = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), filename = Buffer.from(name), compressed = deflateRawSync(data);
    let checksum = 0xffffffff;
    for (const byte of data) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
const paragraph = text => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;
function hwpxFile(body, name = 'synthetic.HWPX') {
  return new File([zip([
    ['mimetype', 'application/hwp+zip'],
    ['Contents/content.hpf', '<opf:package xmlns:opf="urn:opf"><opf:manifest><opf:item id="s0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="s0"/></opf:spine></opf:package>'],
    ['Contents/header.xml', '<hh:head xmlns:hh="urn:head"><hh:charPr id="0"/></hh:head>'],
    ['Contents/section0.xml', `<hs:sec xmlns:hs="urn:sec" xmlns:hp="urn:paragraph">${body}</hs:sec>`],
  ])], name);
}

test('TXT and quoted CSV answers are read locally with filenames and zero intact', async t => {
  noNetwork(t);
  const txt = await readAnswerFile(new File(['1: 0\n2: -3\n3: 2/7'], 'answers.TXT'));
  assert.deepEqual(pairs(txt), [[1, '0'], [2, '-3'], [3, '2/7']]);
  assert.ok(txt.entries.every(entry => entry.sourceFileName === 'answers.TXT'));
  const csv = await readAnswerFile(new File(['과목,구분,번호,정답\r\n수학,미적분,23,0\r\n국어,,1,"ㄱ, ㄴ"'], 'answers.csv'));
  assert.deepEqual(pairs(csv), [[23, '0'], [1, 'ㄱ, ㄴ']]);
  assert.equal(csv.entries[0].subject, '수학');
  assert.equal(csv.entries[0].sectionLabel, '미적분');
  assert.equal(csv.entries[1].sourceFileName, 'answers.csv');
});

test('empty, oversized and unsupported files fail before reading file contents', async t => {
  noNetwork(t);
  let reads = 0;
  const unread = (name, size) => ({ name, size, text: async () => { reads++; throw new Error('Unexpected read'); }, arrayBuffer: async () => { reads++; throw new Error('Unexpected read'); } });
  await assert.rejects(readAnswerFile(unread('empty.txt', 0)), /40MB.*비어 있지 않은/);
  await assert.rejects(readAnswerFile(unread('large.pdf', 40_000_001)), /40MB/);
  await assert.rejects(readAnswerFile(unread('native.hwp', 100)), /PDF·HWPX·UTF-8 TXT\/CSV/);
  await assert.rejects(readAnswerFile(unread('answers.xlsx', 100)), /PDF·HWPX·UTF-8 TXT\/CSV/);
  assert.equal(reads, 0);
  const boundary = await readAnswerFile({ name: 'boundary.txt', size: 40_000_000, text: async () => '1: 0' });
  assert.deepEqual(pairs(boundary), [[1, '0']]);
});

test('undecodable text and malformed CSV do not become guessed answers', async t => {
  noNetwork(t);
  await assert.rejects(readAnswerFile(new File([Uint8Array.of(0xff, 0xfe, 0x31)], 'legacy.txt')), /UTF-8/);
  const malformed = await readAnswerFile(new File(['번호,정답\n1,"0'], 'broken.csv'));
  assert.equal(malformed.entries.length, 0);
  assert.ok(malformed.warnings.some(warning => warning.includes('따옴표')));
  const blank = await readAnswerFile(new File(['번호,정답\n1,\n2,0'], 'blank.csv'));
  assert.deepEqual(pairs(blank), [[2, '0']]);
});

test('real synthetic HWPX bytes yield only explicitly marked book answers', async t => {
  noNetwork(t);
  const item = (page, code, answer) => [
    `#강 01 #쪽 ${page} #번 001 #문항코드 ${code}`, '[문제]', '검증용으로 만든 문항입니다.', '1 4',
    '[정답/모범답안]', answer, '[해설]', '1 정답: ⑤',
  ].map(paragraph).join('');
  const result = await readAnswerFile(hwpxFile(item('006', 'synthetic-1', '0') + item('007', 'synthetic-2', '③')));
  assert.deepEqual(result.entries.map(entry => [entry.sourceItemId, entry.sectionLabel, entry.number, entry.value]), [
    ['synthetic-1', '01강 · 006쪽', 1, '0'], ['synthetic-2', '01강 · 007쪽', 1, '③'],
  ]);
  assert.ok(result.entries.every(entry => entry.sourceFileName === 'synthetic.HWPX'));
  assert.ok(result.warnings.some(warning => warning.includes('페이지')));
});

test('HWPX answer tables keep cell boundaries through the file router', async t => {
  noNetwork(t);
  const cells = (row, values) => `<hp:tr>${values.map((value, column) => `<hp:tc><hp:subList>${paragraph(value)}</hp:subList><hp:cellAddr rowAddr="${row}" colAddr="${column}"/><hp:cellSpan rowSpan="1" colSpan="1"/></hp:tc>`).join('')}</hp:tr>`;
  const table = `<hp:p><hp:run><hp:tbl rowCnt="3" colCnt="2">${cells(0, ['번호', '정답'])}${cells(1, ['1', '0'])}${cells(2, ['2', '백두 산'])}</hp:tbl></hp:run></hp:p>`;
  assert.deepEqual(pairs(await readAnswerFile(hwpxFile(table))), [[1, '0'], [2, '백두 산']]);
});

test('footnote and endnote answers are rejected rather than silently omitted', async t => {
  noNetwork(t);
  for (const note of ['footNote', 'endNote']) {
    const body = `${paragraph('1: 0')}<hp:p id="anchor"><hp:run><hp:ctrl><hp:${note}><hp:subList>${paragraph('2: ③')}</hp:subList></hp:${note}></hp:ctrl><hp:t>본문</hp:t></hp:run></hp:p>`;
    await assert.rejects(readAnswerFile(hwpxFile(body)), /각주·미주.*아직 지원하지 않습니다/);
  }
});

// Valid, tiny PDFs with a built-in Helvetica font and explicit text positions.
// These contain synthetic ASCII tables only and are never persisted to disk.
function pdfBytes(lines, pages = 1) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let page = 0; page < pages; page++) {
    const pageId = objects.length, streamId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    const stream = lines.map((line, index) => `BT /F1 12 Tf 30 ${550 - index * 24} Td (${line.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n');
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${pages} /Kids [${kids.join(' ')}] >>`;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) { offsets.push(Buffer.byteLength(body)); body += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
async function enablePdfWorker(t) {
  const pdfRequire = createRequire(require.resolve('pdfjs-dist/package.json'));
  const canvas = pdfRequire('@napi-rs/canvas');
  for (const [key, value] of Object.entries({ DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D })) {
    const previous = globalThis[key]; globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
  }
  const previous = globalThis.pdfjsWorker;
  globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  t.after(() => { if (previous === undefined) delete globalThis.pdfjsWorker; else globalThis.pdfjsWorker = previous; });
}

test('synthetic PDF font text is positioned and parsed without network requests', async t => {
  noNetwork(t);
  await enablePdfWorker(t);
  const progress = [];
  const result = await readAnswerFile(new File([pdfBytes(['number 1 2 3', 'answer 0 -2 3/7'])], 'synthetic.pdf'), value => progress.push(value));
  assert.deepEqual(pairs(result), [[1, '0'], [2, '-2'], [3, '3/7']]);
  assert.ok(result.entries.every(entry => entry.sourcePage === 1 && entry.sourceFileName === 'synthetic.pdf'));
  assert.ok(progress.some(value => value.includes('1/1')));
});

test('blank PDFs warn about missing text and PDFs over 100 pages are rejected', async t => {
  noNetwork(t);
  await enablePdfWorker(t);
  const blank = await readAnswerFile(new File([pdfBytes([])], 'blank.pdf'));
  assert.equal(blank.entries.length, 0);
  assert.ok(blank.warnings.some(warning => warning.includes('텍스트 판독이 불가능')));
  await assert.rejects(readAnswerFile(new File([pdfBytes([], 101)], 'many-pages.pdf')), /100쪽 이하/);
});
