/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareHwpxParagraphStyles } = require('../lib/hwpx-text-styles.ts');
const { createHwpxBytesFromTemplate } = require('../lib/document-export.ts');

const templateDir = path.join(__dirname, '../public/hwpx-template');
const template = new Map(fs.readdirSync(templateDir, { recursive: true })
  .filter(name => fs.statSync(path.join(templateDir, name)).isFile())
  .map(name => [name.replaceAll(path.sep, '/'), fs.readFileSync(path.join(templateDir, name))]));
const baseHeader = template.get('Contents/header.xml').toString();
const properties = header => header.match(/<hh:paraProperties\b[^>]*>[\s\S]*?<\/hh:paraProperties>/)[0];
const styles = header => new Map([...properties(header).matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<\/hh:paraPr>/g)]
  .map(match => [match[1], match[0]]));
const keepStyle = header => [...styles(header)].find(([, xml]) => /keepWithNext="1"/.test(xml))?.[0];
function unpack(bytes) {
  const b = Buffer.from(bytes), files = new Map();
  for (let offset = 0; b.readUInt32LE(offset) === 0x04034b50;) {
    const size = b.readUInt32LE(offset + 18), nameLength = b.readUInt16LE(offset + 26), extra = b.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extra;
    files.set(b.toString('utf8', offset + 30, offset + 30 + nameLength), b.subarray(start, start + size).toString());
    offset = start + size;
  }
  return files;
}
function exported(text, extra = {}) {
  const files = unpack(createHwpxBytesFromTemplate('페이지 연결 검증', [{ number: 1, text, standardCode: '', standard: '', domain: '', ...extra }], template));
  return { header: files.get('Contents/header.xml'), xml: files.get('Contents/section0.xml') };
}
function paragraphAt(xml, text) {
  const index = xml.indexOf(text);
  assert.notEqual(index, -1, `missing expected text ${text}`);
  const start = xml.lastIndexOf('<hp:p ', index);
  return xml.slice(start, xml.indexOf('</hp:p>', index) + '</hp:p>'.length);
}
const paragraphStyle = paragraph => paragraph.match(/\bparaPrIDRef="(\d+)"/)[1];

test('HWPX keep-with-next style clones the body style without modifying original paragraph properties', () => {
  const result = prepareHwpxParagraphStyles(baseHeader), before = styles(baseHeader), after = styles(result.header);
  assert.equal(after.size, before.size + 1);
  assert.equal(Number(properties(result.header).match(/itemCnt="(\d+)"/)[1]), after.size);
  for (const [id, style] of before) assert.equal(after.get(id), style, `existing style ${id} must be unchanged`);
  const id = keepStyle(result.header);
  assert.equal(Number(id), Math.max(...[...before.keys()].map(Number)) + 1);
  const added = after.get(id);
  assert.match(added, /keepWithNext="1"/);
  assert.match(added, /keepLines="1"/);
  assert.equal(added.replace(/\bid="\d+"/, 'id="0"').replace('keepWithNext="1"', 'keepWithNext="0"').replace('keepLines="1"', 'keepLines="0"'), before.get('0'));
});

test('HWPX keep style allocates after the greatest paragraph ID, not the item count', () => {
  const sparse = baseHeader.replace('<hh:paraPr id="19"', '<hh:paraPr id="77"');
  const result = prepareHwpxParagraphStyles(sparse);
  assert.equal(keepStyle(result.header), '78');
  assert.equal(styles(result.header).size, 21);
  assert.equal(properties(result.header).match(/itemCnt="(\d+)"/)[1], '21');
});

test('HWPX box and table titles and final lead-in stay with the following grid, not ordinary prose or cells', () => {
  const { header, xml } = exported('일반 첫 문장\n표 앞 마지막 문장\n\n:::box <보기>\nㄱ. 보기 셀 내용이다.\nㄴ. 두 번째 셀 문장이다.\n:::\n표 뒤 독립 문장\n:::table 측정 결과\n| 머리글 | 값 |\n| --- | --- |\n| A | 2 |\n:::\n마지막 독립 문장');
  const id = keepStyle(header);
  assert.ok(id);
  for (const text of ['표 앞 마지막 문장', '&lt;보기&gt;', '표 뒤 독립 문장', '측정 결과']) assert.equal(paragraphStyle(paragraphAt(xml, text)), id, text);
  for (const text of ['일반 첫 문장', 'ㄱ. 보기 셀 내용이다.', 'ㄴ. 두 번째 셀 문장이다.', '머리글', '마지막 독립 문장']) assert.equal(paragraphStyle(paragraphAt(xml, text)), '0', text);
  for (const table of xml.matchAll(/<hp:p\b[^>]*>\s*<hp:run\b[^>]*>\s*<hp:tbl\b/g)) assert.equal(paragraphStyle(table[0]), '0', 'table anchor must not chain into the next paragraph');
  assert.equal((xml.match(/pageBreak="CELL"/g) || []).length, 2, 'retain the existing long-table page-break behavior');
});

test('HWPX nested boxes keep outer and inner titles with their first segments without nesting tables', () => {
  const { header, xml } = exported(':::box 바깥 자료\n첫 번째 자료 내용\n:::table 안쪽 표\n| 항목 | 수치 |\n| A | 5 |\n:::\n:::box 안쪽 보기\nㄱ. 안쪽 내용\n:::\n:::');
  const id = keepStyle(header);
  for (const text of ['바깥 자료', '안쪽 표', '안쪽 보기']) assert.equal(paragraphStyle(paragraphAt(xml, text)), id, text);
  for (const text of ['첫 번째 자료 내용', 'ㄱ. 안쪽 내용']) assert.equal(paragraphStyle(paragraphAt(xml, text)), '0', text);
  assert.equal((xml.match(/<hp:tbl\b/g) || []).length, 3);
  for (const table of xml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)) assert.equal((table[0].match(/<hp:tbl\b/g) || []).length, 1, 'do not reintroduce clipped nested tables');
});

test('HWPX source-image title paragraphs preserve keep-with-next through the image-aware export path', () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=';
  const { header, xml } = exported(':::box 제목 그림 [삽입 그림: shared]\n셀 본문 [삽입 그림: shared] 뒤\n:::', {
    sourceFormat: 'hwpx', sourceFingerprint: 'a'.repeat(64), sourceImages: [{ id: 'shared', image }],
  });
  const title = paragraphAt(xml, '제목 그림'), cell = paragraphAt(xml, '셀 본문');
  assert.equal(paragraphStyle(title), keepStyle(header));
  assert.equal(paragraphStyle(cell), '0');
  assert.match(title, /<hp:pic\b/);
  assert.match(cell, /<hp:pic\b/);
  assert.equal((xml.match(/<hp:pic\b/g) || []).length, 2);
  assert.doesNotMatch(xml, /삽입 그림/);
});
