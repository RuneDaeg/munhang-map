/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHwpxBytesFromTemplate } = require('../lib/document-export.ts');
const templateDir = path.join(__dirname, '../public/hwpx-template');
const template = new Map(fs.readdirSync(templateDir, { recursive: true }).filter((name) => fs.statSync(path.join(templateDir, name)).isFile()).map((name) => [name.replaceAll(path.sep, '/'), fs.readFileSync(path.join(templateDir, name))]));
function unpack(bytes) {
  const data = Buffer.from(bytes), result = new Map();
  for (let offset = 0; data.readUInt32LE(offset) === 0x04034b50;) {
    const size = data.readUInt32LE(offset + 18), nameLength = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28);
    const name = data.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
    assert.equal(data.readUInt16LE(offset + 8), 0);
    result.set(name, data.subarray(start, start + size).toString());
    offset = start + size;
  }
  return result;
}
const question = (text, number = 13) => ({ number, text, standardCode: '', standard: '', domain: '' });
const exportXml = (text) => unpack(createHwpxBytesFromTemplate('수식 검증', [question(text)], template));

test('HWPX emits native equations in prose, boxes and cells rather than dollar-delimited text', () => {
  const files = exportXml('속력 $v_A$\n:::box\n◦ 이산화탄소 $CO_2$와 탄산 칼슘 $CaCO_3$\\n◦ 다음 자료\n:::\n:::table\n| 속력 | 극한 |\n| --- | --- |\n| $v_B$ | $\\lim_{x\\to3}\\frac{x^2-x-6}{x-3}$ |\n:::');
  const xml = files.get('Contents/section0.xml');
  assert.equal(files.keys().next().value, 'mimetype');
  assert.equal(files.get('mimetype'), 'application/hwp+zip');
  assert.equal((xml.match(/<hp:equation\b/g) || []).length, 5);
  assert.equal((xml.match(/<hp:tbl\b/g) || []).length, 2);
  assert.match(xml, /<hp:script>[^<]*rm[^<]*C/);
  assert.match(xml, /OVER/);
  assert.match(xml, /다음 자료/);
  assert.doesNotMatch(xml, /\$|\\n|\\frac|\\mathrm|linesegarray/);
  const ids = [...xml.matchAll(/<(?:hp:p|hp:tbl|hp:equation)\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('HWPX multiline cases stay one equation and formulas increase table row height', () => {
  const cases = '$$f(x)=\\begin{cases}x^2&x>0\\\\\n0&x\\le0\\end{cases}$$';
  const formulaXml = exportXml(`:::box\n${cases}\n:::`).get('Contents/section0.xml');
  assert.equal((formulaXml.match(/<hp:equation\b/g) || []).length, 1);
  assert.match(formulaXml, /CASES/);
  assert.doesNotMatch(formulaXml, /\$|\\begin|\\end/);
  const plainXml = exportXml(':::box\nx\n:::').get('Contents/section0.xml');
  const cellHeight = (xml) => Number(xml.match(/<hp:cellSz\b[^>]*height="(\d+)"/)[1]);
  assert.ok(cellHeight(formulaXml) > cellHeight(plainXml));
});

test('HWPX preserves native underline/bold around prose and a complete chemical formula', () => {
  const files = exportXml('<b><u>용해된 $CO_2$의 양</u></b>');
  const section = files.get('Contents/section0.xml');
  const header = files.get('Contents/header.xml');
  assert.match(header, /<hh:underline type="BOTTOM"/);
  assert.match(section, /<hp:equation\b/);
  assert.match(section, /<hp:script>[^<]*UNDER/);
  assert.doesNotMatch(section, /&lt;[bu]&gt;|\$/);
});

test('HWPX refuses invalid or partially formatted math with question number', () => {
  for (const text of ['$x^{2}^{3}$', '$v_A', '$\\unsupported{x}$', '$a\n+b$', '속력 $<b>v_A</b>$이다.', '$[b]v_A[/b]$', '$[u]v_A[/u]$']) {
    assert.throws(() => createHwpxBytesFromTemplate('검증', [question(text, 17)], template), /17번 문항:/);
  }
  assert.doesNotThrow(() => exportXml('① $10\n② $20\n③ $30\n④ $40\n⑤ $50'));
});
