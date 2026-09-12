/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { latexToOmml } = require('../lib/docx-math.ts');
const { latexToHwpScript, latexToHwpxEquation, measureHwpxMath } = require('../lib/hwpx-math.ts');
const { createDocxBytes, createHwpxBytesFromTemplate } = require('../lib/document-export.ts');

test('inline boxes keep native borders and editable letters, circled labels and nested math', () => {
  for (const label of ['A', 'B', 'C']) {
    assert.match(latexToOmml(`\\boxed{${label}}`), new RegExp(`<m:borderBox><m:e>[\\s\\S]*<m:t[^>]*>${label}</m:t>[\\s\\S]*</m:e></m:borderBox>`));
    assert.equal(latexToHwpScript(`\\boxed{${label}}`), `BOX {{it ${label}}}`);
  }
  for (const label of ['㉠', '㉡']) {
    assert.match(latexToOmml(`\\boxed{\\text{${label}}}`), new RegExp(`<m:borderBox>[\\s\\S]*${label}[\\s\\S]*</m:borderBox>`));
    assert.equal(latexToHwpScript(`\\boxed{\\text{${label}}}`), `BOX {{rm "${label}"}}`);
  }
  const latex = String.raw`\boxed{\frac{a_1}{2}}`;
  assert.match(latexToOmml(latex), /<m:borderBox><m:e><m:f>[\s\S]*<m:sSub>/);
  assert.match(latexToHwpScript(latex), /^BOX \{\{\{\{it a\}\} _ \{1\}\} OVER \{2\}\}$/);
  const native = latexToHwpxEquation(String.raw`\boxed{\text{㉠}}`, { id: 1, bold: true, underline: true });
  assert.match(native, /<hp:script>UNDER \{BOLD \{BOX /);
  assert.doesNotMatch(native, /<hp:pic|\\boxed|\$/);
  const plain = measureHwpxMath('A'), boxed = measureHwpxMath(String.raw`\boxed{A}`);
  assert.ok(boxed.width > plain.width && boxed.height > plain.height);
});

test('unsupported enclosure semantics still fail instead of becoming ordinary rectangles', () => {
  for (const latex of [String.raw`\cancel{x}`, String.raw`\bcancel{x}`, String.raw`\xcancel{x}`, String.raw`\colorbox{red}{x}`]) {
    assert.throws(() => latexToOmml(latex), /Word 편집형 수식으로 변환할 수 없습니다/);
    assert.throws(() => latexToHwpScript(latex), /한글 편집형 수식으로 변환할 수 없습니다/);
  }
});

test('question prose, material boxes and table cells export boxed blanks without rasterizing', () => {
  const question = { number: 6, standardCode: '', standard: '', domain: '', text: String.raw`물체 $\boxed{A}$와 $\boxed{B}$
:::box
중성자는 $\boxed{\text{㉠}}$이다.
:::
:::table
| 기호 | 식 |
| --- | --- |
| $\boxed{\text{㉡}}$ | $\boxed{\frac{a_1}{2}}$ |
:::` };
  const dir = path.join(__dirname, '../public/hwpx-template');
  const template = new Map(fs.readdirSync(dir, { recursive: true }).filter((file) => fs.statSync(path.join(dir, file)).isFile()).map((file) => [file, fs.readFileSync(path.join(dir, file))]));
  const docx = Buffer.from(createDocxBytes('Inline box regression', [question])).toString().match(/<w:document\b[\s\S]*?<\/w:document>/)[0];
  const hwpx = Buffer.from(createHwpxBytesFromTemplate('Inline box regression', [question], template)).toString().match(/<hs:sec\b[\s\S]*?<\/hs:sec>/)[0];
  assert.equal((docx.match(/<m:borderBox>/g) || []).length, 5);
  assert.equal((hwpx.match(/<hp:script>BOX /g) || []).length, 5);
  assert.doesNotMatch(docx + hwpx, /\\boxed|<hp:pic|<w:drawing/);
});

test('partial reactions retain terminal operators literally without changing complete expressions', () => {
  for (const latex of ['+', 'x+', String.raw`\mathrm{He}+`, 'x=', String.raw`x\to`, String.raw`x+\,`]) {
    const omml = latexToOmml(latex);
    assert.match(omml, /<m:rPr><m:lit\/><m:sty m:val="p"\/><\/m:rPr>/);
    assert.doesNotMatch(omml, /<m:e><\/m:e>|<w:drawing|\?+/);
  }
  for (const latex of ['x+y', 'x=y', '-x', String.raw`\mathrm{H}+\boxed{\text{㉠}}`, String.raw`\sum_{i=1}^{n}a_i`]) {
    assert.doesNotMatch(latexToOmml(latex), /<m:lit/);
  }
  assert.match(latexToOmml('+', { bold: true }), /<m:lit\/><m:sty m:val="b"\/>/);
});

test('mass-only and atomic-number-only prescripts have intentional blank slots, not placeholders', () => {
  for (const [latex, emptyTag, number] of [
    [String.raw`{}^{35}\mathrm{Cl}_2`, 'sub', '35'],
    [String.raw`{}_{1}\mathrm{H}`, 'sup', '1'],
  ]) {
    const omml = latexToOmml(latex);
    assert.match(omml, new RegExp(`<m:sPre>[\\s\\S]*<m:${emptyTag}><m:r>[\\s\\S]*<m:t xml:space="preserve"> </m:t></m:r></m:${emptyTag}>`));
    assert.doesNotMatch(omml, /<m:(?:sub|sup)><\/m:(?:sub|sup)>/);
    const characters = [...omml.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map((m) => m[1]).join('').replace(/\s/g, '');
    assert.equal(characters, emptyTag === 'sub' ? `${number}Cl2` : `${number}H`);
  }
  const nuclear = latexToOmml(String.raw`{}^{2}_{1}\mathrm{H}`);
  assert.doesNotMatch(nuclear, /<m:t[^>]*> <\/m:t>/);
  assert.equal([...nuclear.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map((m) => m[1]).join(''), '12H');
});
