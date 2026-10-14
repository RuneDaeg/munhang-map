/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hwpxViewBox } = require('../lib/hwpx-layout.ts');
const { parseHwpx } = require('../lib/hwpx-import.ts');
const { parseQuestionContent } = require('../lib/question-content.ts');
const { createDocxBytes, createHwpxBytesFromTemplate } = require('../lib/document-export.ts');

const invisible = { left: false, right: false, top: false, bottom: false };
const cell = (row, column, text, extra = {}) => ({ row, column, rowSpan: 1, colSpan: 1, text, plainText: text, borders: invisible, blocks: [{ kind: 'paragraph' }], ...extra });
const title = () => cell(0, 2, '＜ 보 기 ＞', { rowSpan: 2 });
const body = () => cell(2, 1, 'ㄱ. 속력이 변한다.\nㄴ. $v_1$이다.', { colSpan: 3 });

test('collapses only the presentation of an invisible-cell 보기 layout', () => {
  const cells = [cell(0, 0, '', { colSpan: 2 }), title(), body(), cell(3, 0, '', { colSpan: 5 })];
  const before = structuredClone(cells);
  assert.deepEqual(hwpxViewBox(cells), { title: '<보기>', text: body().text });
  assert.deepEqual(cells, before, 'source cell coordinates, spans and text must not be mutated');
  assert.equal(hwpxViewBox([title(), body(), cell(3, 1, 'ㄷ. 다른 문장', { colSpan: 3 })]).text,
    `${body().text}\nㄷ. 다른 문장`);
});

test('does not collapse real grids, ambiguous styles or embedded data tables', () => {
  for (const cells of [
    [cell(0, 2, '자료'), body()],
    [title(), title(), body()],
    [title(), { ...body(), borders: undefined }],
    [title(), { ...body(), borders: { ...invisible, bottom: true } }],
    [title(), { ...body(), blocks: [{ kind: 'table' }] }],
    [title(), body(), cell(2, 4, '숫자 열')],
    [title(), body(), cell(1, 0, '제목 앞 자료')],
    [title(), body(), cell(2, 1, '겹치는 셀', { colSpan: 3 })],
    [title(), { ...body(), text: ':::table\n|a|b|\n:::' }],
  ]) assert.equal(hwpxViewBox(cells), undefined);
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
// A small stored ZIP writer keeps the synthetic fixture independent of private books.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of entries) {
    const data = Buffer.from(value), n = Buffer.from(name), crc = crc32(data), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += h.length + n.length + data.length;
  }
  const c = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(c.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, e]);
}
function unpack(bytes) {
  const data = Buffer.from(bytes), entries = new Map();
  for (let offset = 0; data.readUInt32LE(offset) === 0x04034b50;) {
    assert.equal(data.readUInt16LE(offset + 8), 0);
    const size = data.readUInt32LE(offset + 18), n = data.readUInt16LE(offset + 26), x = data.readUInt16LE(offset + 28), start = offset + 30 + n + x;
    entries.set(data.toString('utf8', offset + 30, offset + 30 + n), data.subarray(start, start + size).toString());
    offset = start + size;
  }
  return entries;
}
const p = (text) => `<hp:p><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const tc = (row, col, rows, cols, border, contents = '') => `<hp:tc borderFillIDRef="${border}"><hp:subList>${contents}</hp:subList><hp:cellAddr rowAddr="${row}" colAddr="${col}"/><hp:cellSpan rowSpan="${rows}" colSpan="${cols}"/></hp:tc>`;
const border = (id, edges) => `<hh:borderFill id="${id}">${['left', 'right', 'top', 'bottom'].map(edge => `<hh:${edge}Border type="${edges.includes(edge) ? 'SOLID' : 'NONE'}"/>`).join('')}</hh:borderFill>`;
const header = `<hh:head xmlns:hh="urn:head"><hh:charPr id="0"><hh:underline type="BOTTOM"/></hh:charPr>${border(3, ['left', 'right', 'top', 'bottom'])}${border(5, ['bottom'])}${border(7, [])}${border(8, ['left', 'top'])}${border(9, ['right', 'top'])}${border(10, ['left'])}${border(11, ['right'])}${border(12, ['left', 'right', 'bottom'])}</hh:head>`;
const table = `<hp:p><hp:run><hp:tbl rowCnt="4" colCnt="5" borderFillIDRef="3">
<hp:tr>${tc(0, 0, 1, 2, 5)}${tc(0, 2, 2, 1, 7, p('＜ 보 기 ＞'))}${tc(0, 3, 1, 2, 5)}</hp:tr>
<hp:tr>${tc(1, 0, 1, 2, 8)}${tc(1, 3, 1, 2, 9)}</hp:tr>
<hp:tr>${tc(2, 0, 1, 1, 10)}${tc(2, 1, 1, 3, 7, p('ㄱ. 속력이 변한다.') + '<hp:p><hp:run><hp:t>ㄴ. </hp:t><hp:equation><hp:script>v _{1}</hp:script></hp:equation><hp:t>이다.</hp:t></hp:run></hp:p>' + p('ㄷ. 방향이 같다.'))}${tc(2, 4, 1, 1, 11)}</hp:tr>
<hp:tr>${tc(3, 0, 1, 5, 12)}</hp:tr></hp:tbl></hp:run></hp:p>`;
function fixture(body, head = header) {
  return zip([['mimetype', 'application/hwp+zip'], ['Contents/header.xml', head],
    ['Contents/content.hpf', '<opf:package xmlns:opf="urn:opf"><opf:manifest><opf:item id="section0" href="Contents/section0.xml"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>'],
    ['Contents/section0.xml', `<hs:sec xmlns:hs="urn:sec" xmlns:hp="urn:paragraph">${body}</hs:sec>`]]);
}

test('imports decorative HWPX 보기 grid as one box and exports one table in both formats', async () => {
  const imported = await parseHwpx(fixture(table)), block = imported.blocks[0];
  assert.equal(block.kind, 'table');
  assert.equal(block.cells.length, 9);
  assert.equal(block.rows, 4); assert.equal(block.columns, 5);
  assert.equal(block.cells.find(c => c.row === 2 && c.column === 1).colSpan, 3);
  assert.deepEqual(block.presentation, { kind: 'box', title: '<보기>', reason: 'layout-view' });
  assert.match(block.text, /^:::box <보기>\n/);
  assert.match(block.text, /<u>ㄱ\. 속력이 변한다\.<\/u>/);
  assert.match(block.text, /\$v_/);
  assert.doesNotMatch(block.text, /\|/);
  const content = parseQuestionContent(block.text);
  assert.equal(content.length, 1); assert.equal(content[0].kind, 'box');
  const question = { number: 1, text: block.text, standardCode: '', standard: '', domain: '' };
  const templateDir = path.join(__dirname, '../public/hwpx-template');
  const template = new Map(fs.readdirSync(templateDir, { recursive: true }).filter(n => fs.statSync(path.join(templateDir, n)).isFile()).map(n => [n.replaceAll(path.sep, '/'), fs.readFileSync(path.join(templateDir, n))]));
  const hwpx = unpack(createHwpxBytesFromTemplate('보기 검증', [question], template)).get('Contents/section0.xml');
  const docx = unpack(createDocxBytes('보기 검증', [question])).get('word/document.xml');
  for (const [xml, prefix] of [[hwpx, 'hp'], [docx, 'w']]) {
    assert.equal((xml.match(new RegExp(`<${prefix}:tbl\\b`, 'g')) || []).length, 1);
    assert.equal((xml.match(new RegExp(`<${prefix}:tc\\b`, 'g')) || []).length, 1);
    for (const text of ['보기', '속력이 변한다', '방향이 같다']) assert.ok(xml.includes(text), text);
  }
  assert.match(hwpx, /<hp:equation\b/); assert.match(docx, /<m:oMath\b/);
});

test('missing or visible style data leaves the source table intact', async () => {
  for (const head of [header.replace(border(7, []), ''), header.replace(border(7, []), border(7, ['bottom']))]) {
    const result = await parseHwpx(fixture(table, head));
    assert.equal(result.blocks[0].presentation, undefined);
    assert.equal(parseQuestionContent(result.blocks[0].text)[0].kind, 'table');
  }
});

test('multiline unsupported native math keeps its exact source but one visible marker', async () => {
  const script = 'UNKNOWN {a _1}\r\n + {b ^2}';
  const result = await parseHwpx(fixture(`<hp:p><hp:run><hp:equation><hp:script>${script}</hp:script></hp:equation></hp:run></hp:p>`));
  assert.equal(result.blocks[0].runs[0].script, script);
  assert.equal(result.blocks[0].text, '[한글 수식: UNKNOWN {a _1}  + {b ^2}]');
  const { mathQualityIssues } = require('../lib/math-quality.ts');
  assert.deepEqual(mathQualityIssues(result.text), []);
});

test('a literal source backslash cannot escape the next native equation delimiter', async () => {
  const result = await parseHwpx(fixture('<hp:p><hp:run><hp:t>전압 2\\</hp:t></hp:run><hp:run><hp:t></hp:t><hp:equation><hp:script>V</hp:script></hp:equation><hp:t>이다.</hp:t></hp:run></hp:p>'));
  assert.equal(result.blocks[0].runs[0].text, '전압 2\\');
  assert.equal(result.text, '전압 2\\ $V$이다.');
  const { mathQualityIssues } = require('../lib/math-quality.ts');
  assert.deepEqual(mathQualityIssues(result.text), []);
});

test('accepts book XML above 16 MiB but retains a finite 24 MiB XML bound', async () => {
  const large = `<!--${' '.repeat(17 * 1024 * 1024)}-->${p('1. 시험 문항')}`;
  assert.equal((await parseHwpx(fixture(large))).blocks[0].plainText, '1. 시험 문항');
  await assert.rejects(() => parseHwpx(fixture(`<!--${' '.repeat(24 * 1024 * 1024)}-->`)), /XML|크기|제한/);
});
