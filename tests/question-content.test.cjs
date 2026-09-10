/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { parseQuestionContent, questionPlainText, splitTableRow, tableColumnWeights } = require('../lib/question-content.ts');
const MathText = require('../components/math-text.tsx').default;
const { createDocxBytes, createHwpxBytesFromTemplate } = require('../lib/document-export.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const { serializeReview } = require('../lib/review-file.ts');
const { createQuestionBank } = require('../local/question-bank.cjs');
const { createStandardArchive } = require('../lib/document-export.ts');

// Synthetic, redistributable fixture; never embed users' exam PDFs in tests.
const text = '다음은 측정 자료이다.\n:::box\n측정한 길이는 12 cm이다.\n단위와 수치를 확인한다.\n:::\n이에 대한 설명으로 옳은 것은?\n:::box <보기>\nㄱ. 단위를 비교한다.\nㄴ. 측정값을 기록한다.\n:::\n① ㄱ ② ㄴ\n:::table 탐구 결과\n| 대상 | 길이 |\n| --- | --- |\n| A | 12 cm |\n| B | 24 cm |\n:::';
const question = { number: 2, text, standardCode: '[test]', domain: '통합과학', standard: '측정 자료를 해석한다.', type: 'test', confidence: 80 };

function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = new Map();
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18), n = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + n), start = offset + 30 + n + extra;
    files.set(name, buffer.subarray(start, start + size)); offset = start + size;
  }
  return files;
}

test('two independent source/view boxes and a grid preserve the full reading order', () => {
  const blocks = parseQuestionContent(text);
  assert.deepEqual(blocks.map(b => b.kind), ['text', 'box', 'text', 'box', 'text', 'table']);
  assert.equal(blocks[1].title, '');
  assert.equal(blocks[3].title, '<보기>');
  assert.deepEqual(blocks[5].rows, [['대상', '길이'], ['A', '12 cm'], ['B', '24 cm']]);
  assert.equal(blocks[5].header, true);
  const plain = questionPlainText(text);
  assert.doesNotMatch(plain, /:::|---/);
  for (const fragment of ['다음은 측정', '단위와 수치', '이에 대한', '① ㄱ', '24 cm']) assert.ok(plain.includes(fragment));
});

test('table splitting preserves math pipes, escaped pipes and formulas', () => {
  assert.deepEqual(splitTableRow(String.raw`| $|x|$ | $\frac{a}{b}$ | A\|B |`), ['$|x|$', String.raw`$\frac{a}{b}$`, 'A|B']);
  assert.equal(splitTableRow('| $unfinished | value |'), null);
  assert.equal(parseQuestionContent('| A | B |\n| --- | --- |\n| 1 | 2 |')[0].kind, 'table');
  assert.equal(parseQuestionContent(':::table\n| A | B |\n| 1 | 2 |\n:::')[0].header, false);
  assert.deepEqual(parseQuestionContent(String.raw`$\begin{array}{|c|c|}1&2\end{array}$`).map(b => b.kind), ['text']);
});

test('malformed, oversized and unclosed structures keep all original text', () => {
  const invalid = [':::box\n내용', ':::box\n:::box 안쪽\n내용\n:::', ':::table\n| A | B |\n| 1 |\n:::', '| A | B |\n| --- | --- |\n| 1 |', ':::table\n' + Array(81).fill('| A | B |').join('\n') + '\n:::'];
  for (const input of invalid) {
    assert.equal(parseQuestionContent(input).every(b => b.kind === 'text'), true);
    assert.equal(questionPlainText(input), input);
  }
  const weights = tableColumnWeights([['짧음', '길고 상세한 자료 설명'], ['A', '긴 내용을 가진 두 번째 열']]);
  assert.equal(weights[0], 6); assert.ok(weights[1] > weights[0]);
});

test('nested boxes retain two inner tables once in preview and plain text',()=>{
  const source=':::box 실험 자료\n조건을 확인한다.\n:::table\n| 비커 | 색깔 |\n| --- | --- |\n| A | 노랑 |\n:::\n다음 결과이다.\n:::table\n| 비커 | 값 |\n| --- | --- |\n| A | 12 |\n:::\n:::';
  assert.equal(parseQuestionContent(source)[0].kind,'box');
  const html=renderToStaticMarkup(React.createElement(MathText,{text:source}));
  assert.equal((html.match(/<table\b/g)||[]).length,2);
  assert.equal((html.match(/노랑/g)||[]).length,1);
  assert.doesNotMatch(questionPlainText(source),/:::/);
});

test('preview builds accessible data tables, keeps boxes separate, and escapes HTML', () => {
  const html = renderToStaticMarkup(React.createElement(MathText, { text: text + '\n:::box <script>\n<img src=x onerror=alert(1)> $x^2$\n:::' }));
  assert.equal((html.match(/<table\b/g) || []).length, 1);
  assert.equal((html.match(/<section\b/g) || []).length, 3);
  assert.match(html, /scope="col"/); assert.match(html, /katex/);
  assert.doesNotMatch(html, /<script>|<img src=x|:::box/);
  const compact = renderToStaticMarkup(React.createElement(MathText, { text, compact: true }));
  assert.doesNotMatch(compact, /<table\b|<section\b|:::/);
  assert.match(compact, /24 cm/);
});

test('DOCX exports native editable tables in place, not screenshots or duplicate prose', () => {
  const files = unzip(createDocxBytes('표 검증', [question]));
  const xml = files.get('word/document.xml').toString();
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 3);
  assert.equal((xml.match(/<w:tc>/g) || []).length, 8);
  assert.match(xml, /<w:tblHeader\/>/);
  assert.match(xml, /<w:cantSplit\/>/);
  assert.doesNotMatch(xml, /w:hRule="exact"|:::box|:::table/);
  assert.equal((xml.match(/측정한 길이는 12 cm이다/g) || []).length, 1);
  assert.ok(xml.indexOf('측정한 길이') < xml.indexOf('이에 대한'));
  assert.ok(xml.indexOf('이에 대한') < xml.indexOf('&lt;보기&gt;'));
});

test('HWPX exports native cells, matching geometry and new border styles without changing template styles', () => {
  const root = path.join(__dirname, '../public/hwpx-template');
  const template = new Map();
  function add(dir) { for (const file of fs.readdirSync(dir, { withFileTypes: true })) { const name = path.join(dir, file.name); if (file.isDirectory()) add(name); else template.set(path.relative(root, name), fs.readFileSync(name)); } }
  add(root);
  const files = unzip(createHwpxBytesFromTemplate('표 검증', [question], template));
  const xml = files.get('Contents/section0.xml').toString();
  const header = files.get('Contents/header.xml').toString();
  assert.equal(files.keys().next().value, 'mimetype');
  assert.equal((xml.match(/<hp:tbl\b/g) || []).length, 3);
  assert.equal((xml.match(/<hp:tc\b/g) || []).length, 8);
  assert.match(xml, /rowCnt="3" colCnt="2"/);
  assert.match(xml, /colAddr="1" rowAddr="2"/);
  assert.match(header, /<hh:borderFills itemCnt="4">/);
  assert.match(header, /<hh:borderFill id="3"/);
  for (const style of template.get('Contents/header.xml').toString().matchAll(/<hh:charPr\b[\s\S]*?<\/hh:charPr>/g)) assert.ok(header.includes(style[0]), 'original character styles must remain byte-identical');
  assert.match(header, /<hh:charProperties itemCnt="28">/);
  const ids = [...xml.matchAll(/<hp:(?:p|tbl)\b[^>]*\bid="(\d+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(xml, /linesegarray|SQUEEZE|:::box|:::table/);
  assert.equal((xml.match(/측정한 길이는 12 cm이다/g) || []).length, 1);
  for (const table of xml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)) {
    const size = table[0].match(/<hp:sz width="(\d+)"[^>]*height="(\d+)"/);
    let height = 0;
    for (const row of table[0].matchAll(/<hp:tr>[\s\S]*?<\/hp:tr>/g)) {
      const cells = [...row[0].matchAll(/<hp:cellSz width="(\d+)" height="(\d+)"/g)];
      assert.equal(cells.reduce((sum, cell) => sum + Number(cell[1]), 0), Number(size[1]));
      assert.ok(cells.every(cell => cell[2] === cells[0][2]));
      height += Number(cells[0][2]);
    }
    assert.equal(height, Number(size[2]));
  }
});

test('AI recognition and review serialization retain table structure and original capture', async (t) => {
  const previousFetch = global.fetch; t.after(() => { global.fetch = previousFetch; });
  const capture = { page: 1, box: [0, 0, 0.5, 0.5], image: 'data:image/jpeg;base64,/9j/2Q==' };
  global.fetch = async () => Response.json({ questions: [{ number: 2, latexText: text, indirectStem: '다음은 측정 자료이다.', directStem: '이에 대한 설명으로 옳은 것은?', choices: ['① ㄱ', '② ㄴ'] }] });
  const result = await enhanceQuestionsWithVision([{ ...question, text: questionPlainText(text), questionCaptures: [capture] }]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.questions[0].text, text);
  assert.deepEqual(result.questions[0].questionCaptures, [capture]);
  assert.equal(JSON.parse(serializeReview('fixture.pdf', result.questions, [capture.image])).questions[0].text, text);
});

test('table edits survive bank restart and grouped document export across two PDFs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-table-bank-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bank = createQuestionBank(root);
  const captured = { ...question, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image: 'data:image/jpeg;base64,/9j/2Q==' }] };
  bank.save({ sourceFileName: 'one.pdf', sourceFingerprint: 'a'.repeat(64), questions: [captured] });
  bank.save({ sourceFileName: 'two.pdf', sourceFingerprint: 'b'.repeat(64), questions: [{ ...captured, text: text.replace('12 cm', '13 cm') }] });
  const reopened = createQuestionBank(root);
  const selected = reopened.select(reopened.list().map(item => item.id));
  assert.equal(selected.length, 2);
  assert.equal(selected.find(item => item.sourceFileName === 'one.pdf').text, text);
  assert.ok(selected.find(item => item.sourceFileName === 'two.pdf').text.includes('13 cm'));
  const archive = unzip(await createStandardArchive('문제함', selected, 'docx'));
  const document = [...archive].find(([name]) => name.endsWith('.docx'))[1];
  const xml = unzip(document).get('word/document.xml').toString();
  assert.equal((xml.match(/<w:tbl>/g) || []).length, 6);
  assert.match(xml, /one.pdf/); assert.match(xml, /two.pdf/);
});
