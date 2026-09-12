/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { latexToOmml } = require('../lib/docx-math.ts');

// Check structural XML with an independent stack rather than matching only
// element counts. Ordered children below are from Microsoft's CT_* particles:
// https://github.com/dotnet/Open-XML-SDK/blob/main/data/schemas/schemas_openxmlformats_org_officeDocument_2006_math.json
function tree(xml) {
  const root = { name: 'root', children: [] }, stack = [root];
  for (const token of xml.match(/<[^>]+>/g)) {
    const close = /^<\/([^>]+)>$/.exec(token);
    if (close) { assert.equal(stack.pop().name, close[1]); continue; }
    const name = /^<([^\s/>]+)/.exec(token)[1];
    const node = { name, children: [], token };
    stack.at(-1).children.push(node);
    if (!token.endsWith('/>')) stack.push(node);
  }
  assert.equal(stack.length, 1, 'all XML elements close');
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].name, 'm:oMath');
  return root.children[0];
}

function all(node, name) {
  return [node, ...node.children.flatMap((child) => all(child))].filter((item) => !name || item.name === name);
}

function text(xml) {
  return [...xml.matchAll(/<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g)].map((match) => match[1]).join('');
}

function assertOrder(node, required, optional = []) {
  const actual = node.children.map((child) => child.name);
  assert.deepEqual(actual.filter((name) => !optional.includes(name)), required, node.name);
}

const examples = [
  String.raw`\frac{a+\frac{b}{c}}{d}`, String.raw`\binom{n}{r}`,
  String.raw`\sqrt{x}+\sqrt[3]{y}`, String.raw`x_1^{n+1}+y^2+z_0`,
  String.raw`\sum\limits_{k=1}^{n} a_k`, String.raw`\int_0^1 x^2\,\mathrm{d}x`,
  String.raw`\lim\limits_{x\to0}\frac{\sin x}{x}`, String.raw`{}^{14}_{6}\mathrm{C}`,
  String.raw`\left\{x\middle|x>0\right\}`, String.raw`\left.\frac{x}{2}\right|_0^1`,
  String.raw`\overline{AB}+\underline{CD}+\vec{x}+\widehat{ABC}`,
  String.raw`\underbrace{x+y}_{n}`, String.raw`\overset{a}{\to}`,
  String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  String.raw`f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`,
  String.raw`\begin{aligned}a&=b+c\\d&=e\end{aligned}`,
];

test('generated structures follow the native OMML child ordering', () => {
  for (const latex of examples) {
    const root = tree(latexToOmml(latex));
    for (const node of all(root)) {
      if (node.name === 'm:f') assertOrder(node, ['m:num', 'm:den'], ['m:fPr']);
      if (node.name === 'm:rad') assertOrder(node, ['m:radPr', 'm:deg', 'm:e']);
      if (node.name === 'm:sSubSup') assertOrder(node, ['m:e', 'm:sub', 'm:sup']);
      if (node.name === 'm:sSub') assertOrder(node, ['m:e', 'm:sub']);
      if (node.name === 'm:sSup') assertOrder(node, ['m:e', 'm:sup']);
      if (node.name === 'm:sPre') assertOrder(node, ['m:sub', 'm:sup', 'm:e']);
      if (node.name === 'm:nary') assertOrder(node, ['m:naryPr', 'm:sub', 'm:sup', 'm:e']);
      if (node.name === 'm:naryPr') assertOrder(node, ['m:chr', 'm:limLoc', 'm:grow', 'm:subHide', 'm:supHide']);
      if (node.name === 'm:dPr') assertOrder(node, ['m:begChr', 'm:sepChr', 'm:endChr', 'm:grow']);
      if (node.name === 'm:limLow' || node.name === 'm:limUpp') assertOrder(node, ['m:e', 'm:lim']);
      if (node.name === 'm:bar') assertOrder(node, ['m:barPr', 'm:e']);
      if (node.name === 'm:acc') assertOrder(node, ['m:accPr', 'm:e']);
      if (node.name === 'm:groupChr') assertOrder(node, ['m:groupChrPr', 'm:e']);
      if (node.name === 'm:groupChrPr') assertOrder(node, ['m:chr', 'm:pos', 'm:vertJc']);
      if (node.name === 'm:mcPr') assertOrder(node, ['m:count', 'm:mcJc']);
      if (node.name === 'm:r') assertOrder(node, ['m:rPr', 'w:rPr', 'm:t']);
      if (node.name === 'm:rPr') {
        const names = node.children.map((child) => child.name);
        assert.ok(JSON.stringify(names) === '["m:nor"]' || JSON.stringify(names) === '["m:scr","m:sty"]');
      }
      if (node.name === 'm:m') {
        assert.equal(node.children[0].name, 'm:mPr');
        assert.ok(node.children.slice(1).every((child) => child.name === 'm:mr'));
      }
    }
  }
});

test('nested fractions and binomial stacks retain every numerator and denominator', () => {
  const fraction = latexToOmml(String.raw`\frac{a+\frac{b}{c}}{d}`);
  assert.equal(all(tree(fraction), 'm:f').length, 2);
  assert.equal(text(fraction), 'a+bcd');
  const binomial = latexToOmml(String.raw`\binom{n}{r}`);
  assert.match(binomial, /<m:type m:val="noBar"\/>/);
  assert.match(binomial, /<m:begChr m:val="\("\/>/);
  assert.equal(text(binomial), 'nr');
  assert.doesNotMatch(binomial, /\\binom|\\frac|<w:drawing/);
});

test('radicals, nested scripts and pre-scripts retain their argument roles', () => {
  const roots = latexToOmml(String.raw`\sqrt{x}+\sqrt[3]{y}`);
  assert.equal(all(tree(roots), 'm:rad').length, 2);
  assert.match(roots, /<m:degHide m:val="1"\/>/);
  assert.match(roots, /<m:degHide m:val="0"\/>/);
  assert.equal(text(roots), 'x+3y');
  const scripts = latexToOmml(String.raw`x_{i_j}^{n^2}`);
  assert.equal(all(tree(scripts), 'm:sSubSup').length, 1);
  assert.equal(all(tree(scripts), 'm:sSub').length, 1);
  assert.equal(all(tree(scripts), 'm:sSup').length, 1);
  assert.equal(text(scripts), 'xijn2');
  const isotope = latexToOmml(String.raw`{}^{14}_{6}\mathrm{C}`);
  assert.equal(all(tree(isotope), 'm:sPre').length, 1);
  assert.equal(text(isotope), '614C');
});

test('sum/product limits and integral bounds become native n-ary objects with operands', () => {
  for (const [command, char] of [['sum', '∑'], ['prod', '∏']]) {
    const result = latexToOmml(`\\${command}\\limits_{i=1}^n a_i`);
    const nary = all(tree(result), 'm:nary')[0];
    assert.ok(nary.children.at(-1).children.length > 0, 'summand is inside the n-ary argument');
    assert.match(result, new RegExp(`<m:chr m:val="${char}"/>`));
    assert.match(result, /<m:limLoc m:val="undOvr"\/>/);
    assert.equal(text(result), 'i=1nai');
  }
  const integral = latexToOmml(String.raw`\int_0^1 x^2\,\mathrm{d}x`);
  assert.match(integral, /<m:chr m:val="∫"\/>/);
  assert.match(integral, /<m:limLoc m:val="subSup"\/>/);
  assert.equal(text(integral), '01x2\u2009dx');
  const noLimits = latexToOmml(String.raw`\sum\nolimits_i a_i`, { display: true });
  assert.match(noLimits, /<m:limLoc m:val="subSup"\/>/);
  const nested = latexToOmml(String.raw`\sum\limits_i\sum\limits_j a_{ij}`);
  const operators = all(tree(nested), 'm:nary');
  assert.equal(operators.length, 2);
  assert.equal(operators[0].children.at(-1).children[0].name, 'm:nary');
  assert.equal(operators[1].children.at(-1).children[0].name, 'm:sSub');
  const spaced = latexToOmml(String.raw`\sum\limits_i\,a_i`);
  assert.ok(all(tree(spaced), 'm:nary')[0].children.at(-1).children.some((child) => child.name === 'm:sSub'));
});

test('ordinary balanced parentheses are the complete n-ary operand without consuming later terms', () => {
  for (const command of ['sum', 'prod', 'int']) {
    const result = latexToOmml(`\\${command}\\limits_{k=1}^{24}(S_{k+1}-S_k)+b`);
    const root = tree(result), nary = all(root, 'm:nary')[0];
    const operand = nary.children.at(-1);
    assert.ok(operand.children.length > 3, 'all of the delimited operand is inside m:e');
    assert.equal(operand.children.at(-1).name, 'm:r');
    assert.equal(root.children.at(-1).name, 'm:r', 'following b stays outside the sum');
    assert.equal(text(result), 'k=124(Sk+1−Sk)+b');
  }
  const nested = latexToOmml(String.raw`\sum_i[(a_i+b_i)c_i]+d`);
  assert.equal(all(tree(nested), 'm:nary')[0].children.at(-1).children.at(-1).name, 'm:r');
  assert.equal(text(nested), 'i[(ai+bi)ci]+d');
});

test('limits, upright function names and symbols stay native math without raw commands', () => {
  const result = latexToOmml(String.raw`\lim\limits_{x\to0}\frac{\sin x}{x}+\log_2 y\le\infty`);
  assert.equal(all(tree(result), 'm:limLow').length, 1);
  assert.equal(all(tree(result), 'm:f').length, 1);
  assert.match(result, /<m:t xml:space="preserve">lim<\/m:t>/);
  assert.match(result, /<m:sty m:val="p"\/>/);
  assert.ok(text(result).includes('x→0'));
  assert.ok(text(result).includes('≤∞'));
  assert.doesNotMatch(result, /\\lim|\\sin|\\log|\$/);
});

test('upright chemistry, mathematical alphabets, bold and underline are retained', () => {
  const chemistry = latexToOmml(String.raw`\mathrm{Ca}(\mathrm{OH})_2+\mathrm{SO}_4^{2-}`);
  assert.equal(text(chemistry), 'Ca(OH)2+SO42−');
  assert.equal(all(tree(chemistry), 'm:sSubSup').length, 1);
  for (const char of ['C', 'a', 'O', 'H', 'S']) {
    assert.match(chemistry, new RegExp(`<m:r><m:rPr><m:nor/></m:rPr><w:rPr>[^<]*[\\s\\S]*?<w:i w:val="0"/>[\\s\\S]*?<m:t xml:space="preserve">${char}</m:t>`));
  }
  const formatted = latexToOmml(String.raw`x+\mathrm{H}+\mathbb{R}+\mathcal{F}+\text{조건}`, { bold: true, underline: true });
  assert.match(formatted, /<m:sty m:val="bi"\/>/);
  assert.match(formatted, /<m:sty m:val="b"\/>/);
  assert.match(formatted, /<m:scr m:val="double-struck"\/>/);
  assert.match(formatted, /<m:scr m:val="script"\/>/);
  assert.equal(tree(formatted).children[0].name, 'm:bar');
  assert.equal(all(tree(formatted), 'm:bar').length, 1, 'one underline spans the whole formula');
  assert.match(formatted, /<m:pos m:val="bot"\/>/);
  for (const run of all(tree(formatted), 'm:r')) {
    const wordPr = run.children.find((child) => child.name === 'w:rPr');
    assert.ok(wordPr.children.some((child) => child.name === 'w:b'));
    assert.ok(!wordPr.children.some((child) => child.name === 'w:u'), 'no per-atom double underline');
  }
});

test('stretchy, nested and one-sided delimiters keep boundaries and middle separators', () => {
  const nested = latexToOmml(String.raw`\left(\frac{a}{b}+\left[c\right]\right)`);
  assert.equal(all(tree(nested), 'm:d').length, 2);
  assert.equal(text(nested), 'ab+c');
  const set = latexToOmml(String.raw`\left\{x\middle|x>0\right\}`);
  const delimiter = all(tree(set), 'm:d')[0];
  assert.equal(delimiter.children.filter((child) => child.name === 'm:e').length, 2);
  assert.match(set, /<m:sepChr m:val="\|"\/>/);
  const evaluation = latexToOmml(String.raw`\left.\frac{x}{2}\right|_0^1`);
  assert.match(evaluation, /<m:begChr m:val=""\/>/);
  assert.match(evaluation, /<m:endChr m:val="∣"\/>/);
  assert.equal(all(tree(evaluation), 'm:sSubSup').length, 1);
});

test('overline/underline, vector accents, grouping braces and labels remain structural', () => {
  const result = latexToOmml(String.raw`\overline{AB}+\underline{CD}+\vec{x}+\hat{y}+\tilde{z}`);
  assert.equal(all(tree(result), 'm:bar').length, 2);
  assert.equal(all(tree(result), 'm:acc').length, 3);
  assert.match(result, /<m:pos m:val="top"\/>/);
  assert.match(result, /<m:pos m:val="bot"\/>/);
  assert.equal(text(result), 'AB+CD+x+y+z');
  const group = latexToOmml(String.raw`\underbrace{x+y}_{n}+\overbrace{a+b}^{k}`);
  assert.equal(all(tree(group), 'm:groupChr').length, 2);
  assert.equal(all(tree(group), 'm:limLow').length, 1);
  assert.equal(all(tree(group), 'm:limUpp').length, 1);
  assert.equal(text(group), 'x+yn+a+bk');
});

test('matrices, cases and aligned rows retain all cells and column alignment', () => {
  const matrix = latexToOmml(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`);
  assert.equal(all(tree(matrix), 'm:mr').length, 2);
  assert.equal(all(tree(matrix), 'm:mc').length, 2);
  assert.equal(text(matrix), 'abcd');
  const cases = latexToOmml(String.raw`f(x)=\begin{cases}x^2&x>0\\0&x\le0\end{cases}`);
  assert.equal(all(tree(cases), 'm:mr').length, 2);
  assert.match(cases, /<m:begChr m:val="\{"\/>/);
  assert.match(cases, /<m:endChr m:val=""\/>/);
  assert.match(cases, /<m:mcJc m:val="left"\/>/);
  assert.equal(text(cases), 'f(x)=x2x&gt;00x≤0');
  const aligned = latexToOmml(String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`);
  assert.equal(all(tree(aligned), 'm:mr').length, 2);
  assert.match(aligned, /<m:mcJc m:val="right"\/>/);
  assert.match(aligned, /<m:mcJc m:val="left"\/>/);
  assert.equal(text(aligned), 'a=bc=d');
});

test('XML-sensitive text is escaped and no network or browser globals are needed', (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  global.fetch = () => { throw new Error('converter must not fetch'); };
  const result = latexToOmml(String.raw`a<b\quad\text{A\&B <xml> "quote"}`);
  tree(result);
  assert.ok(text(result).includes('&amp;'));
  assert.ok(text(result).includes('&lt;xml&gt;'));
  assert.doesNotMatch(result, /<xml>|<annotation|<math\b|<span\b/);
});

test('unsupported structures and malformed LaTeX fail explicitly, without silently dropping children', () => {
  for (const latex of [String.raw`\phantom{x}`, String.raw`\cancel{x}`, String.raw`\boxed{x}`, String.raw`\color{red}{x}`, String.raw`\href{https://example.com}{x}`, String.raw`\includegraphics{https://example.com/a.png}`, String.raw`a\\b`, String.raw`\begin{array}{c|c}a&b\end{array}`, String.raw`\unknowncommand{x}`, String.raw`\frac{1}{`, '', 'x'.repeat(20_001)]) {
    assert.throws(() => latexToOmml(latex), /Word 편집형 수식으로 변환할 수 없습니다/, latex);
  }
});

test('inline and display options each return one embeddable oMath, without paragraph wrappers', () => {
  for (const display of [false, true]) {
    const result = latexToOmml(String.raw`\frac{1}{2}`, { display });
    assert.equal(tree(result).name, 'm:oMath');
    assert.doesNotMatch(result, /<w:p|<m:oMathPara/);
    assert.equal(text(result), '12');
  }
});
