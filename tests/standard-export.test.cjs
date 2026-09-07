/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStandardArchive, groupQuestionsByStandard } = require('../lib/document-export.ts');
const image = 'data:image/jpeg;base64,/9j/2Q==';
const sample = (code, sourceFileName, text) => ({ number: 1, type: 'test', text, standardCode: code, domain: '고등학교 · 통합과학1', standard: '성취기준', confidence: 80, sourceFileName, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image }] });
const questions = [sample('[같은기준]', 'first.pdf', '첫 번째 PDF 문항'), sample('[다른기준]', 'second.pdf', '다른 기준 문항'), sample('[같은기준]', 'second.pdf', '두 번째 PDF 문항'), sample('', '=formula.pdf', '미분류 문항')];
function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = new Map();
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength), start = offset + 30 + nameLength + extra;
    files.set(name, buffer.subarray(start, start + size)); offset = start + size;
  }
  return files;
}

test('grouping uses the selected standard and subject; missing standards are never dropped', () => {
  const groups = groupQuestionsByStandard(questions);
  assert.equal(groups.length, 3);
  assert.equal(groups.find((group) => group.code === '[같은기준]').questions.length, 2);
  assert.equal(groups.find((group) => group.code === '미분류').questions.length, 1);
  assert.equal(groupQuestionsByStandard([questions[0], { ...questions[0], domain: '다른 교과' }]).length, 2);
});

test('DOCX ZIP contains one document per standard, both sources and all images, plus a safe CSV index', async () => {
  const progress = [];
  const files = unzip(await createStandardArchive('문제함', questions, 'docx', (done, total) => progress.push([done, total])));
  assert.equal(files.size, 4);
  assert.deepEqual(progress, [[0, 3], [1, 3], [2, 3], [3, 3]]);
  const entry = [...files.keys()].find((name) => name.includes('[같은기준]'));
  const docx = unzip(files.get(entry));
  const xml = docx.get('word/document.xml').toString();
  assert.match(xml, /first.pdf.*1번/); assert.match(xml, /second.pdf.*1번/);
  assert.match(xml, /첫 번째 PDF 문항/); assert.match(xml, /두 번째 PDF 문항/);
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 2);
  assert.match(files.get('문항목록.csv').toString(), /'=formula.pdf/);
  assert.ok([...files.keys()].every((name) => !/[\\/]/.test(name)));
});

test('HWPX grouped ZIP retains templates, captured figures and original PDF labels', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  global.fetch = async (url) => { assert.ok(url.startsWith('/hwpx-template/')); return new Response(fs.readFileSync(path.join(__dirname, '../public', url))); };
  const files = unzip(await createStandardArchive('문제함', questions, 'hwpx'));
  const entry = [...files.keys()].find((name) => name.includes('[같은기준]'));
  const hwpx = unzip(files.get(entry));
  assert.equal(hwpx.keys().next().value, 'mimetype');
  const section = hwpx.get('Contents/section0.xml').toString();
  assert.match(section, /first.pdf/); assert.match(section, /second.pdf/);
  assert.equal((section.match(/<hp:pic /g) || []).length, 2);
});

test('prose bullets stay readable in both exported formats instead of leaking LaTeX commands', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  global.fetch = async (url) => new Response(fs.readFileSync(path.join(__dirname, '../public', url)));
  const question = sample('[기호]', 'source.pdf', String.raw`\bullet 섬 A의 자료이다.\n\bullet 개체수 \rightarrow 증가`);
  for (const format of ['docx', 'hwpx']) {
    const archive = unzip(await createStandardArchive('기호 검증', [question], format));
    const document = unzip([...archive].find(([name]) => name.endsWith(`.${format}`))[1]);
    const xml = document.get(format === 'docx' ? 'word/document.xml' : 'Contents/section0.xml').toString();
    assert.match(xml, /• 섬 A의 자료이다/);
    assert.match(xml, /• 개체수 → 증가/);
    assert.doesNotMatch(xml, /\\bullet|\\rightarrow|\\n/);
  }
});
