/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { inflateSync } = require('node:zlib');
const { parseHwpx, hwpxEquationToLatex } = require('../lib/hwpx-import.ts');
const { createHwpxBytesFromTemplate } = require('../lib/document-export.ts');

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries, options = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value), nameBytes = Buffer.from(name);
    const method = options.deflate ? 8 : 0, compressed = method ? deflateRawSync(data) : data;
    const flags = 0x800 | (options.encrypted ? 1 : 0) | (options.descriptor ? 8 : 0), crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(method, 8);
    if (!options.descriptor) { head.writeUInt32LE(crc, 14); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(data.length, 22); }
    head.writeUInt16LE(nameBytes.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBytes.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBytes); local.push(head, nameBytes, compressed);
    offset += head.length + nameBytes.length + compressed.length;
    if (options.descriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(data.length, 12);
      local.push(descriptor); offset += descriptor.length;
    }
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
const section = (body) => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="urn:sec" xmlns:hp="urn:paragraph" xmlns:hc="urn:core">${body}</hs:sec>`;
const p = (text, attrs = '') => `<hp:p id="42" ${attrs}><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const entries = (body, extra = [], header = '') => [
  ['mimetype', 'application/hwp+zip'],
  ['Contents/content.hpf', '<opf:package xmlns:opf="urn:opf"><opf:manifest><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="img1" href="BinData/image1.png" media-type="image/png"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>'],
  ['Contents/header.xml', `<hh:head xmlns:hh="urn:head"><hh:charPr id="0"><hh:bold/><hh:underline type="BOTTOM"/></hh:charPr>${header}</hh:head>`],
  ['Contents/section0.xml', section(body)], ...extra,
];

test('reads local HWPX compressed paragraphs, inline formatting, entities and explicit breaks', async () => {
  const result = await parseHwpx(zip(entries(p('1. 가 &amp; 나<hp:lineBreak/>둘째 줄<hp:tab/>끝')), { deflate: true, descriptor: true }));
  assert.equal(result.format, 'hwpx');
  assert.equal(result.sections.length, 1);
  assert.equal(result.blocks[0].plainText, '1. 가 & 나\n둘째 줄\t끝');
  assert.match(result.text, /<b><u>1\. 가 & 나<\/u><\/b>/);
  assert.equal(result.blocks[0].runs[0].charPrIDRef, '0');
  assert.equal(result.hasOriginalPageCaptures, false);
  assert.ok(result.warnings.some((warning) => warning.includes('쪽수')));
  assert.equal('sourcePageImage' in result, false);
});

test('preserves table cell coordinates, spans, paragraph breaks and nested blocks', async () => {
  const cell = (body, row, column, rowSpan = 1, colSpan = 1) => `<hp:tc><hp:subList>${body}</hp:subList><hp:cellAddr rowAddr="${row}" colAddr="${column}"/><hp:cellSpan rowSpan="${rowSpan}" colSpan="${colSpan}"/></hp:tc>`;
  const table = `<hp:p><hp:run><hp:tbl rowCnt="2" colCnt="2"><hp:tr>${cell(p('합친 셀'), 0, 0, 1, 2)}</hp:tr><hp:tr>${cell(p('첫 줄') + p('둘째 줄'), 1, 0)}${cell(p('값 2'), 1, 1)}</hp:tr></hp:tbl></hp:run></hp:p>`;
  const result = await parseHwpx(zip(entries(table)));
  const block = result.blocks[0];
  assert.equal(block.kind, 'table');
  assert.equal(block.cells.length, 3);
  assert.equal(block.cells[0].colSpan, 2);
  assert.equal(block.cells[1].plainText, '첫 줄\n둘째 줄');
  assert.match(block.text, /<br>/);
  assert.ok(result.warnings.some((warning) => warning.includes('병합 셀')));
});

test('keeps unsupported native equations explicitly while converting supported math', async () => {
  const result = await parseHwpx(zip(entries('<hp:p><hp:run><hp:t>1. 수식 </hp:t><hp:equation><hp:script>{x ^ {2} + 1} OVER {2}</hp:script></hp:equation><hp:t> 와 </hp:t><hp:equation><hp:script>MATRIX { a &amp; b # c &amp; d }</hp:script></hp:equation></hp:run></hp:p>')));
  const equations = result.blocks[0].runs.filter((run) => run.kind === 'equation');
  assert.match(equations[0].latex, /\\frac/);
  assert.equal(equations[1].latex, undefined);
  assert.equal(equations[1].script, 'MATRIX { a & b # c & d }');
  assert.match(result.text, /\[한글 수식: MATRIX/);
  assert.ok(result.warnings.some((warning) => warning.includes('한글 수식')));
});

test('native math subset is bounded and refuses unsupported commands without guessing', () => {
  for (const script of ['x ^ {2} + 1', '{1} over {2}', 'sqrt {x}', 'LEFT ( x + 1 RIGHT )', 'alpha + beta', '{rm C} {rm O}_{2}', 'SUM _{i=1}^{n} x'])
    assert.equal(typeof hwpxEquationToLatex(script), 'string', script);
  for (const script of ['MATRIX {a & b}', 'UNKNOWN x', '\\frac{1}{2}', '{x', 'x}', 'OVER {2}', '{1} OVER', '{'.repeat(1000), 'a'.repeat(20_001)])
    assert.equal(hwpxEquationToLatex(script), undefined, script.slice(0, 80));
});

test('native fractions retain adjacent multiplication and chained equalities outside denominators', () => {
  assert.equal(hwpxEquationToLatex('{1} over {2} v = {3} over {4}'), '\\frac{{1}}{{2}} v = \\frac{{3}}{{4}}');
  assert.equal(hwpxEquationToLatex('a+b over c'), undefined);
  assert.equal(hwpxEquationToLatex('{4 rm ``m} over {8 rm ``s} = {1} over {2} rm ``m/s'), '\\frac{{4 \\, \\, \\mathrm{m}}}{{8 \\, \\, \\mathrm{s}}} = \\frac{{1}}{{2}} \\, \\, \\mathrm{m} / \\mathrm{s}');
});

test('ambiguous postfix scope is preserved natively instead of producing a different formula', () => {
  for (const script of ['x^-1', 'x^+2', 'x_-1', 'x^a^b', 'x_1_2', '{a} over {b}^2', 'BAR a_b', 'sqrt a^2', 'sqrt {a}^2', 'x ` ^2'])
    assert.equal(hwpxEquationToLatex(script), undefined, script);
  assert.equal(hwpxEquationToLatex('x^{-1}'), 'x^{{- 1}}');
  assert.equal(hwpxEquationToLatex('{{a} over {b}}^2'), '{\\frac{{a}}{{b}}}^{2}');
  assert.equal(hwpxEquationToLatex('E _{max}'), undefined, 'bare function scripts cannot round-trip through native document formats');
});

test('notes and page headers stay separate from question body; note counters are not questions', async () => {
  const result = await parseHwpx(zip(entries('<hp:p id="q7"><hp:run><hp:ctrl><hp:header><hp:subList>' + p('999. 머리말') + '</hp:subList></hp:header><hp:endNote><hp:subList><hp:p><hp:run><hp:autoNum num="7" numType="ENDNOTE"/><hp:t>정답 ③</hp:t></hp:run></hp:p></hp:subList></hp:endNote></hp:ctrl><hp:autoNum num="8" numType="FOOTNOTE"/><hp:t>7. 물음에 답하시오.</hp:t></hp:run></hp:p>')));
  assert.equal(result.plainText, '7. 물음에 답하시오.');
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].plainText, '정답 ③');
  assert.equal(result.notes[0].anchorParagraphId, 'q7');
  assert.equal(result.notes[0].number, 7);
  assert.doesNotMatch(result.text, /999|정답|8\./);
});

test('preserves style numbering metadata without manufacturing missing question numbers', async () => {
  const result = await parseHwpx(zip(entries(p('원래 번호 없는 문장', 'paraPrIDRef="1"'), [], '<hh:paraPr id="1"><hh:heading type="NUMBER" idRef="3" level="1"/></hh:paraPr>')));
  assert.deepEqual(result.blocks[0].numbering, { type: 'NUMBER', idRef: '3', level: 1 });
  assert.equal(result.plainText, '원래 번호 없는 문장');
});

test('exposes embedded raster bytes by safe image id without inventing source captures', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=', 'base64');
  const result = await parseHwpx(zip(entries('<hp:p><hp:run><hp:t>1. 그림을 보시오.</hp:t><hp:pic><hc:img binaryItemIDRef="img1"/></hp:pic></hp:run></hp:p>', [['BinData/image1.png', png]])));
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(result.blocks[0].runs[1].imageId, 'img1');
  assert.equal(result.hasOriginalPageCaptures, false);
});

test('multiline image descriptions stay metadata and do not break a table row', async () => {
  const picture = '<hp:pic><hc:img binaryItemIDRef="img1"/><hp:shapeComment>그림 설명\r\n원본 이름: sample.bmp</hp:shapeComment></hp:pic>';
  const body = `<hp:p><hp:run><hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>첫 줄\r\n둘째 줄</hp:t>${picture}</hp:run></hp:p></hp:subList><hp:cellAddr rowAddr="0" colAddr="0"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>`;
  const result = await parseHwpx(zip(entries(body)));
  const table = result.blocks[0], image = table.cells[0].blocks[0].runs.find(run => run.kind === 'image');
  assert.equal(image.alt, '그림 설명\r\n원본 이름: sample.bmp');
  assert.match(table.text, /첫 줄<br>둘째 줄\[삽입 그림: img1\]/);
  assert.doesNotMatch(table.text, /\r|그림 설명|원본 이름/);
  const { parseQuestionContent } = require('../lib/question-content.ts');
  assert.equal(parseQuestionContent(table.text)[0].kind, 'table');
});

test('repacks opaque BMP diagrams to lossless compact PNG without canvas or a remote service', async () => {
  const bitmap = Buffer.alloc(62);
  bitmap.write('BM'); bitmap.writeUInt32LE(62, 2); bitmap.writeUInt32LE(54, 10); bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(2, 18); bitmap.writeInt32LE(1, 22); bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28);
  bitmap.set([0, 0, 255, 0, 255, 0, 0, 0], 54); // red, green, 2 bytes padding
  const list = entries(p('그림'), [['BinData/image1.bmp', bitmap]]);
  list[1][1] = list[1][1].replace('image1.png', 'image1.bmp').replace('image/png', 'image/bmp');
  const result = await parseHwpx(zip(list, { deflate: true }));
  assert.equal(result.images[0].mimeType, 'image/png');
  const png = Buffer.from(result.images[0].dataUrl.split(',')[1], 'base64');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 1);
  const length = png.readUInt32BE(33), compressed = png.subarray(41, 41 + length);
  // Sub-filter encoded RGB bytes: red, then green minus red modulo 256.
  assert.deepEqual([...inflateSync(compressed)], [1, 255, 0, 0, 1, 255, 0]);
});

test('imports a real app-generated HWPX package with native equations and table cells', async () => {
  const templateDir = path.join(__dirname, '../public/hwpx-template');
  const template = new Map(fs.readdirSync(templateDir, { recursive: true })
    .filter((name) => fs.statSync(path.join(templateDir, name)).isFile())
    .map((name) => [name.replaceAll(path.sep, '/'), fs.readFileSync(path.join(templateDir, name))]));
  const bytes = createHwpxBytesFromTemplate('읽기 검증', [{ number: 1, text: '1. <b>값</b> $\\frac{x^2+1}{2}$를 구하시오.\n:::table\n| 구분 | 값 |\n| 가 | 3 |\n:::', standardCode: '', standard: '', domain: '' }], template);
  const result = await parseHwpx(bytes);
  assert.match(result.text, /<b>값<\/b>/);
  assert.match(result.text, /\\frac/);
  assert.ok(result.blocks.some((block) => block.kind === 'table'));
  assert.doesNotMatch(result.text, /\[한글 수식:/);
});

test('rejects encrypted, duplicate, traversal, absolute, broken and oversized ZIPs', async () => {
  await assert.rejects(parseHwpx(zip(entries(p('본문')), { encrypted: true })), /암호화/);
  for (const name of ['../escape.xml', '/absolute.xml', 'Contents/../escape.xml', 'C:\\escape.xml'])
    await assert.rejects(parseHwpx(zip(entries(p('본문'), [[name, 'bad']]))), /경로/);
  await assert.rejects(parseHwpx(zip(entries(p('본문'), [['mimetype', 'application/hwp+zip']]))), /중복/);
  await assert.rejects(parseHwpx(Buffer.from('not a zip')), /크기/);
  const corrupt = zip(entries(p('본문'))); corrupt[38] ^= 1;
  await assert.rejects(parseHwpx(corrupt), /검증 값/);
  const huge = zip(entries(p('본문'))), firstCentral = huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  huge.writeUInt32LE(33 * 1024 * 1024, firstCentral + 24);
  await assert.rejects(parseHwpx(huge), /압축 해제 크기/);
  const wrongName = zip(entries(p('본문'))); wrongName[30] = 120;
  await assert.rejects(parseHwpx(wrongName), /일치하지/);
});

test('rejects XXE, entity expansion, invalid XML, duplicate attributes and invalid Unicode', async () => {
  const bad = [
    '<!DOCTYPE sec [<!ENTITY x SYSTEM "file:///etc/passwd">]><hs:sec>&x;</hs:sec>',
    '<hs:sec><hp:p>&unknown;</hp:p></hs:sec>',
    '<hs:sec><hp:p>raw & bad</hp:p></hs:sec>',
    '<hs:sec><hp:p id="1" id="2"/></hs:sec>',
    '<hs:sec><hp:p></hs:sec>',
    '<hs:sec><hp:p>&#0;</hp:p></hs:sec>',
    '<hs:sec><hp:p>&#xD800;</hp:p></hs:sec>',
    '<hs:sec><hp:p>\u0000</hp:p></hs:sec>',
    '<?evil open="https://example.test"?><hs:sec/>',
  ];
  for (const value of bad) {
    const list = entries(p('본문')); list[3][1] = value;
    await assert.rejects(parseHwpx(zip(list)), /XML|DTD|엔터티/, value);
  }
});

test('rejects unsafe table overlap rather than silently discarding content', async () => {
  const repeated = `<hp:tc><hp:subList>${p('자료')}</hp:subList><hp:cellAddr rowAddr="0" colAddr="0"/></hp:tc>`;
  await assert.rejects(parseHwpx(zip(entries(`<hp:p><hp:run><hp:tbl rowCnt="1" colCnt="2"><hp:tr>${repeated}${repeated}</hp:tr></hp:tbl></hp:run></hp:p>`))), /겹칩니다/);
});

test('external image references never trigger a fetch and executable image formats are omitted', async () => {
  const list = entries(p('본문'), [['BinData/image1.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>']]);
  list[1][1] = list[1][1].replace('image1.png', 'image1.svg').replace('image/png', 'image/svg+xml')
    .replace('</opf:manifest>', '<opf:item id="remote" href="https://example.test/private.png" media-type="image/png"/></opf:manifest>');
  const previous = global.fetch;
  global.fetch = () => { throw new Error('Import must never fetch'); };
  try {
    const result = await parseHwpx(zip(list));
    assert.equal(result.images.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes('외부 링크')));
    assert.ok(result.warnings.some((warning) => warning.includes('그림 형식')));
  } finally { global.fetch = previous; }
});

test('bounds actual inflated output even when ZIP metadata lies about its size', async () => {
  const file = zip(entries(p('가'.repeat(4000))), { deflate: true });
  const end = file.length - 22;
  let at = file.readUInt32LE(end + 16);
  for (let i = 0; i < file.readUInt16LE(end + 10); i++) {
    const length = file.readUInt16LE(at + 28), name = file.toString('utf8', at + 46, at + 46 + length);
    if (name === 'Contents/section0.xml') {
      const local = file.readUInt32LE(at + 42);
      file.writeUInt32LE(64, at + 24); file.writeUInt32LE(64, local + 22);
    }
    at += 46 + length + file.readUInt16LE(at + 30) + file.readUInt16LE(at + 32);
  }
  await assert.rejects(parseHwpx(file), /실제 압축 해제 크기/);
});
