/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createCanvas } = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
const { createDocxBytes, createHwpxBytesFromTemplate } = require('../lib/document-export.ts');
const { parseHwpx } = require('../lib/hwpx-import.ts');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=', 'base64');
const image = `data:image/png;base64,${png.toString('base64')}`;
const source = (id = 'shared', value = image) => ({ id, image: value });
const question = (text, sourceImages = [source()], number = 1) => ({ number, text, standardCode: '[검증]', standard: '그림을 해석한다.', domain: '검증 교과', sourceFormat: 'hwpx', sourceFingerprint: 'a'.repeat(64), sourceImages });
const templateDir = path.join(__dirname, '../public/hwpx-template');
const template = new Map(fs.readdirSync(templateDir, { recursive: true }).filter(name => fs.statSync(path.join(templateDir, name)).isFile()).map(name => [name.replaceAll(path.sep, '/'), fs.readFileSync(path.join(templateDir, name))]));
function unzip(bytes) {
  const b = Buffer.from(bytes), files = new Map();
  for (let offset = 0; b.readUInt32LE(offset) === 0x04034b50;) {
    const size = b.readUInt32LE(offset + 18), nameLength = b.readUInt16LE(offset + 26), extra = b.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extra;
    files.set(b.toString('utf8', offset + 30, offset + 30 + nameLength), b.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}
const formats = [
  { name: 'DOCX', create: qs => createDocxBytes('삽입 위치 검증', qs), xml: 'word/document.xml', marker: '<w:drawing>', media: 'word/media/', id: /<wp:docPr id="(\d+)"/g },
  { name: 'HWPX', create: qs => createHwpxBytesFromTemplate('삽입 위치 검증', qs, template), xml: 'Contents/section0.xml', marker: '<hp:pic ', media: 'BinData/', id: /<hp:pic id="(\d+)"/g },
];

for (const format of formats) {
  test(`${format.name}: PDF and legacy text keep marker-looking prose literal in paragraphs and table cells`, () => {
    for (const sourceFormat of ['pdf', undefined]) {
      const q = { number: 9, text: '그림 표기 [삽입 그림: diagram]\n:::table\n| 자료 | 설명 |\n| [삽입 그림: other] | 그대로 |\n:::', standardCode: '', standard: '', domain: '', sourceFormat };
      const xml = unzip(format.create([q])).get(format.xml).toString();
      assert.match(xml, /\[삽입 그림: diagram\]/);
      assert.match(xml, /\[삽입 그림: other\]/);
      assert.equal(xml.split(format.marker).length - 1, 0);
    }
  });

  test(`${format.name}: an image does not bypass whole-equation rich text validation`, () => {
    for (const math of ['$2<b>^{3}</b>$', '$2<u>^{3}</u>$', '$2[b]^{3}[/b]$', '$2[u]^{3}[/u]$']) {
      for (const content of [`${math} [삽입 그림: shared]`, `:::box\n${math} [삽입 그림: shared]\n:::`, `:::table\n| 값 | 설명 |\n| ${math} [삽입 그림: shared] | 확인 |\n:::`]) {
        assert.throws(() => format.create([question(content, [source()], 8)]), /8번 문항: 수식 일부에 적용된/);
      }
    }
    const xml = unzip(format.create([question('<b>$2^{3}$</b> [삽입 그림: shared] <u>$x_{1}$</u>')])).get(format.xml).toString();
    assert.equal(xml.split(format.marker).length - 1, 1);
    assert.equal((xml.match(format.name === 'DOCX' ? /<m:oMath>/g : /<hp:equation /g) || []).length, 2);
    assert.doesNotMatch(xml, /\$2|\$x/);
  });

  test(`${format.name}: native images replace each marker in text, boxes and cells without an appendix duplicate`, () => {
    const text = '앞문장 [삽입 그림: shared] 뒷문장 $x^2$\n:::box <보기>\n박스앞 [삽입 그림: shared] 박스뒤\n:::\n:::table 자료\n| 첫째 | 둘째 |\n| --- | --- |\n| 셀앞 [삽입 그림: shared] 셀뒤 | 값 |\n:::';
    const files = unzip(format.create([question(text)])), xml = files.get(format.xml).toString();
    assert.equal(xml.split(format.marker).length - 1, 3);
    assert.equal([...files.keys()].filter(name => name.startsWith(format.media)).length, 1);
    assert.doesNotMatch(xml, /삽입 그림|삽입 위치 미확인/);
    for (const [before, after] of [['앞문장', '뒷문장'], ['박스앞', '박스뒤'], ['셀앞', '셀뒤']]) {
      const start = xml.indexOf(before), end = xml.indexOf(after);
      assert.ok(start < xml.indexOf(format.marker, start) && xml.indexOf(format.marker, start) < end);
      assert.equal((xml.slice(start, end).match(format.name === 'DOCX' ? /<\/w:p>/g : /<\/hp:p>/g) || []).length, 0, 'image stays within the surrounding paragraph');
    }
    assert.match(xml, format.name === 'DOCX' ? /<m:oMath>/ : /<hp:equation /);
  });

  test(`${format.name}: repeated IDs draw every occurrence with globally unique instance IDs`, () => {
    const qs = [question(Array(125).fill('[삽입 그림: shared]').join('\n')), question('둘째 문항 [삽입 그림: shared]', [source()], 2)];
    const files = unzip(format.create(qs)), xml = files.get(format.xml).toString();
    const ids = [...xml.matchAll(format.id)].map(match => match[1]);
    assert.equal(ids.length, 126);
    assert.equal(new Set(ids).size, 126);
    assert.equal([...files.keys()].filter(name => name.startsWith(format.media)).length, 1);
    if (format.name === 'HWPX') assert.equal(new Set([...xml.matchAll(/<hp:pic\b[^>]*\binstid="(\d+)"/g)].map(match => match[1])).size, 126);
  });

  test(`${format.name}: source IDs are scoped to each question, while identical bytes may share media`, () => {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d'); context.fillStyle = '#f00'; context.fillRect(0, 0, 8, 8);
    const other = canvas.toDataURL('image/png');
    const files = unzip(format.create([question('첫째 [삽입 그림: shared]', [source()]), question('둘째 [삽입 그림: shared] [삽입 그림: alias]', [source('shared', other), source('alias', other)], 2)]));
    const xml = files.get(format.xml).toString();
    assert.equal(xml.split(format.marker).length - 1, 3);
    const refs = [...xml.matchAll(format.name === 'DOCX' ? /r:embed="([^"]+)"/g : /binaryItemIDRef="([^"]+)"/g)].map(match => match[1]);
    assert.notEqual(refs[0], refs[1]); assert.equal(refs[1], refs[2]);
    assert.equal([...files.keys()].filter(name => name.startsWith(format.media)).length, 2);
  });

  test(`${format.name}: missing markers fail with question identity; unreferenced legacy images remain labelled once`, () => {
    assert.throws(() => format.create([question('문항 [삽입 그림: missing]', [source()], 7)]), /7번 문항: 삽입 그림 missing/);
    assert.throws(() => format.create([question('첫째 [삽입 그림: shared]'), question('둘째 [삽입 그림: shared]', [], 8)]), /8번 문항: 삽입 그림 shared/);
    const xml = unzip(format.create([question('위치 표식이 없는 옛 검토 파일')])).get(format.xml).toString();
    assert.equal(xml.split(format.marker).length - 1, 1);
    assert.match(xml, /삽입 위치 미확인 \(shared\)/);
  });

  test(`${format.name}: native images preserve text formatting and do not change PDF capture/choice appendices`, () => {
    const q = question('<b>굵게앞 [삽입 그림: shared] 굵게뒤</b> <u>밑줄앞 [삽입 그림: shared] 밑줄뒤</u>');
    const pdf = { number: 2, text: 'PDF 본문', standardCode: '', standard: '', domain: '', questionCaptures: [{ image }], visualChoices: [{ label: '①', image }] };
    const xml = unzip(format.create([q, pdf])).get(format.xml).toString();
    assert.equal(xml.split(format.marker).length - 1, 4);
    assert.match(xml, /① 원본 그림 선택지/);
    assert.ok(xml.indexOf('PDF 본문') > xml.indexOf('밑줄뒤'));
    if (format.name === 'DOCX') {
      assert.match(xml, /<w:b\/>[^]*굵게뒤/);
      assert.match(xml, /<w:u w:val="single"\/>[^]*밑줄뒤/);
    }
  });
}

test('HWPX inline images round-trip as pictures at the same paragraph positions', async () => {
  const bytes = createHwpxBytesFromTemplate('왕복 검증', [question('앞 [삽입 그림: shared] 뒤\n:::box <보기>\n보기앞 [삽입 그림: shared] 보기뒤\n:::')], template);
  const parsed = await parseHwpx(bytes);
  assert.match(parsed.text, /앞 \[삽입 그림: image1\] 뒤/);
  assert.match(parsed.text, /보기앞 \[삽입 그림: image1\] 보기뒤/);
  assert.equal(parsed.images.length, 1);
});

test('large images fit table content width, and HWPX cell height includes the full picture', () => {
  const canvas = createCanvas(1200, 600);
  const q = question(':::table\n| 왼쪽 | 오른쪽 |\n| [삽입 그림: shared] | 설명 |\n:::', [source('shared', canvas.toDataURL('image/png'))]);
  const docx = unzip(createDocxBytes('너비 검증', [q])).get('word/document.xml').toString();
  const cell = [...docx.matchAll(/<w:tc>[^]*?<\/w:tc>/g)].map(m => m[0]).find(x => x.includes('<w:drawing>'));
  const cellWidth = Number(cell.match(/<w:tcW w:w="(\d+)"/)[1]), pictureWidth = Number(cell.match(/<wp:extent cx="(\d+)"/)[1]);
  assert.ok(pictureWidth <= (cellWidth - 300) * 635);
  const hwpx = unzip(createHwpxBytesFromTemplate('너비 검증', [q], template)).get('Contents/section0.xml').toString();
  const hcell = [...hwpx.matchAll(/<hp:tc\b[^]*?<\/hp:tc>/g)].map(m => m[0]).find(x => x.includes('<hp:pic '));
  const size = hcell.match(/<hp:cellSz width="(\d+)" height="(\d+)"/), picture = hcell.match(/<hp:pic\b[^]*?<hp:sz width="(\d+)"[^>]*height="(\d+)"/);
  assert.ok(Number(picture[1]) <= Number(size[1]) - 1200);
  assert.ok(Number(size[2]) >= Number(picture[2]) + 1200);
  assert.match(hcell, /treatAsChar="1" affectLSpacing="1"/);
});

test('HWPX cell reserves three rows for three unbreakable pictures wider than half a cell', () => {
  const canvas = createCanvas(300, 100);
  const q = question(':::box\n[삽입 그림: shared] [삽입 그림: shared] [삽입 그림: shared]\n:::', [source('shared', canvas.toDataURL('image/png'))]);
  const xml = unzip(createHwpxBytesFromTemplate('그림 줄바꿈 검증', [q], template)).get('Contents/section0.xml').toString();
  const cell = [...xml.matchAll(/<hp:tc\b[^]*?<\/hp:tc>/g)].map(m => m[0]).find(x => x.includes('<hp:pic '));
  const size = cell.match(/<hp:cellSz width="(\d+)" height="(\d+)"/);
  const pictures = [...cell.matchAll(/<hp:pic\b[^]*?<hp:sz width="(\d+)"[^>]*height="(\d+)"/g)];
  assert.equal(pictures.length, 3);
  assert.ok(pictures.every(p => Number(p[1]) * 2 > Number(size[1]) - 1200));
  assert.ok(Number(size[2]) >= pictures.reduce((sum, p) => sum + Number(p[2]) + 400, 1200), 'all three image rows plus cell padding must fit');
});
