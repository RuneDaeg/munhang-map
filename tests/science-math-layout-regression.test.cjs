/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const katex = require('katex');
const { reconstructMathRuns } = require('../lib/pdf-math-layout.ts');
const { extractPositionedText } = require('../lib/pdf-text.ts');
const { pdfRules } = require('../lib/pdf-structures.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');
const { latexToOmml } = require('../lib/docx-math.ts');
const { latexToHwpxEquation } = require('../lib/hwpx-math.ts');

const run = (text, x, baseline, height = 10, width = 5, extra = {}) => ({
  text, x, y: baseline - height, baseline, height, width, equation: true, ...extra,
});
const prose = (text, x, baseline, height = 10, width = 5) => run(text, x, baseline, height, width,
  { equation: false, sourceFontName: 'Test-Roman' });
function check(items, rules = []) {
  const original = JSON.stringify(items);
  const result = reconstructMathRuns(items, rules);
  assert.equal(result.sourceConserved, true);
  assert.equal(JSON.stringify(items), original);
  for (const item of result.items) if (item.text.startsWith('$')) {
    const formula = item.text.slice(1, -1);
    assert.doesNotThrow(() => katex.renderToString(formula, { throwOnError: true, strict: false }));
    assert.doesNotThrow(() => latexToOmml(formula));
    assert.doesNotThrow(() => latexToHwpxEquation(formula, { id: 1 }));
  }
  return result;
}
const text = result => result.items.map(r => r.text).join(' ');
const scaleRuns = (items, scale) => items.map(r => ({ ...r,
  x: r.x * scale + 32, y: r.y * scale - 42, baseline: r.baseline * scale - 42,
  width: r.width * scale, height: r.height * scale,
}));

test('grouped operator and coefficient runs keep ordinary right scripts, never nuclear indices', () => {
  for (const value of ['< f', '0.4t', '1 ×10', '+ cFe', '[B']) {
    const input = [run(value, 20, 30, 10, 20), run('2', 40.1, 33, 6.8, 3.5)];
    const result = check(input);
    assert.equal(text(result), `$${value}_{2}$`);
    assert.ok(result.events.every(event => event.kind !== 'leftScripts' && event.kind !== 'isotopeMass'));
  }
  const result = check([run('K', 20, 30), run('a', 25.2, 31.6, 6.4, 3)]);
  assert.equal(text(result), '$K_{a}$');
  assert.equal(text(check([run('1 × 10', 20, 30, 10, 28), run('− 7', 48, 26, 6.8, 10)])), '$1 × 10^{− 7}$');
});

test('non-equation-font script geometry preserves roman molecules and italic variable fonts', () => {
  for (const [base, sourceFontName, expected] of [
    ['CO', 'Test-Roman', '\\mathrm{CO}_{2}'], ['C', 'Times-Italic', 'C_{2}'],
    ['NADP', 'Test-Roman', '\\mathrm{NADP}^{+}'], ['H', 'Test-Roman', '\\mathrm{H}^{*}'],
  ]) {
    const upper = base === 'NADP' || base === 'H';
    const input = [prose(base, 10, 30, 11.5, 20), prose(upper ? (base === 'H' ? '*' : '+') : '2', 30.1,
      upper ? 25 : 31.4, 7.36, 3.5)];
    input[0].sourceFontName = sourceFontName;
    for (const scale of [0.5, 1, 2]) for (const items of [input, input.toReversed()]) {
      assert.equal(text(check(scaleRuns(items, scale))), `$${expected}$`);
    }
  }
  assert.equal(text(check([prose('C', 10, 30), prose('2', 15.1, 30, 6.5, 3)])), 'C 2');
  assert.equal(text(check([prose('H, H', 10, 30, 11.5, 25), prose('*', 35.1, 25, 7.36, 3.5)])),
    '$\\mathrm{H}, \\mathrm{H}^{*}$');
});

test('verified per-glyph font roles survive composition without changing script ownership', () => {
  const input = [run('aMnO', 10, 30, 11, 28, { sourceMathLatex: '\\mathit{a}\\mathrm{MnO}' }),
    run('4', 38.1, 33.5, 7, 4), run('−', 40, 26, 7, 4)];
  assert.equal(text(check(input)), '$\\mathit{a}\\mathrm{MnO}^{−}_{4}$');
  assert.equal(text(check([run('K', 10, 30, 10, 6, { sourceMathLatex: '\\mathit{K}' }),
    run('a', 16.1, 31.6, 6.4, 3, { sourceMathLatex: '\\mathrm{a}' })])), '$\\mathit{K}_{\\mathrm{a}}$');
  assert.equal(text(check([run('n', 10, 30, 10, 6, { sourceMathLatex: '\\mathit{n}' })])), '$\\mathit{n}$');
  assert.equal(text(check([run('10', 10, 30, 10, 10),
    run('cm', 20.1, 30, 10, 10, { sourceMathLatex: '\\mathrm{cm}' })])), '$10\\mathrm{cm}$');
});

test('a body-font middle dot between equation operands stays inside the compound unit', () => {
  const left = run('1 cal/g', 10, 30, 10.98, 31.35, { sourceMathLatex: '1 \\mathrm{cal}/\\mathrm{g}' });
  const dot = prose('‧', 42.76, 30, 10.98, 1.92);
  const right = run('℃', 44.26, 30, 10.98, 11.04);
  for (const mark of ['·', '‧', '⋅']) for (const scale of [0.5, 1, 2]) {
    const input = [left, { ...dot, text: mark }, right];
    for (const items of [input, input.toReversed()]) {
      const result = check(scaleRuns(items, scale));
      assert.equal(text(result), '$1 \\mathrm{cal}/\\mathrm{g}\\cdot ℃$');
      assert.equal(result.events.filter(e => e.kind === 'inlineMathOperator').length, 1);
    }
  }
  for (const dotVariant of [prose('‧', 42.76, 34, 10.98, 1.92),
    prose('‧', 42.76, 30, 10.98, 9), prose('㉠', 42.76, 30, 10.98, 1.92)]) {
    const result = check([left, dotVariant, right]);
    assert.equal(result.events.filter(e => e.kind === 'inlineMathOperator').length, 0);
    if (dotVariant.text === '㉠') assert.equal(result.items.length, 3, 'unclassified inline text must block joining across it');
  }
  assert.equal(check([dot, right]).events.filter(e => e.kind === 'inlineMathOperator').length, 0, 'a leading prose bullet is not multiplication');
  assert.equal(check([left, dot, right], [{ x1: 42, x2: 42, y1: 10, y2: 50 }])
    .events.filter(e => e.kind === 'inlineMathOperator').length, 0, 'table-cell boundaries block the bridge');
});

test('numeric body-font fractions keep all five choices paired, while table rules never become fractions', () => {
  const input = [], rules = [];
  for (let i = 0; i < 5; i++) {
    const x = i * 45;
    input.push(prose(String(i + 1), x + 6, 20, 11.5, 5.5), prose(String(i + 6), x + 6, 33.2, 11.5, 5.5));
    rules.push({ x1: x + 1, x2: x + 16, y1: 22.6, y2: 22.6 });
  }
  const result = check(input, rules);
  assert.equal(result.events.filter(e => e.kind === 'fraction').length, 5);
  for (let i = 0; i < 5; i++) assert.match(text(result), new RegExp('\\\\frac\\{' + (i + 1) + '\\}\\{' + (i + 6) + '\\}'));
  const tableRules = [...rules, { x1: 1, x2: 1, y1: 10, y2: 40 }];
  assert.equal(check(input.slice(0, 2), tableRules).events.filter(e => e.kind === 'fraction').length, 0);
});

test('Korean fraction labels and embedded indices stay inside their numerator and denominator', () => {
  const input = [prose('㉠', 10, 20, 11.5, 10), prose('의 수', 20, 20, 11.5, 30),
    prose('㉡', 10, 33.2, 11.5, 10), prose('의 수', 20, 33.2, 11.5, 30)];
  const result = check(input, [{ x1: 8, x2: 53, y1: 22.6, y2: 22.6 }]);
  assert.match(text(result), /\\frac\{㉠\\text\{의 수\}\}\{㉡\\text\{의 수\}\}/);
  const squared = [run('1', 20, 20, 10, 5), prose('주기', 10, 33.2, 11.5, 20), prose('2', 30, 28.2, 7.36, 3.5)];
  assert.match(text(check(squared, [{ x1: 8, x2: 36, y1: 23, y2: 23 }])), /\\frac\{1\}\{\\text\{주기\}\^\{2\}\}/);
});

test('underlined prose followed by another text line never becomes a Korean word fraction', () => {
  const input = [prose('㉠', 0, 20, 11.5, 10),
    { ...prose('큰', 12, 20, 11.5, 11), underline: true },
    { ...prose('공', 29, 20, 11.5, 11), underline: true },
    run('4', 47, 19.7, 10.98, 5.5), prose('개와 작은', 54, 20, 11.5, 48),
    prose('작은', 0, 36.7, 11.5, 22), prose('공', 28, 36.7, 11.5, 11),
    run('1', 46, 36.3, 10.98, 5.5), prose('개를 연결한다', 53, 36.7, 11.5, 66)];
  const result = check(input, [{ x1: 12, x2: 40, y1: 22.6, y2: 22.6 }]);
  assert.equal(result.events.filter(e => e.kind === 'fraction').length, 0);
  assert.equal(result.items.filter(r => r.underline).map(r => r.text).join(' '), '큰 공');
});

test('fraction glyph advance overhang does not exclude its numerator or swallow a following unit', () => {
  const input = [run('─', 20, 30, 10.98, 13.8, { mathRole: 'fractionBar' }),
    run('10', 21.62, 19.265, 10.98, 16.019), run('3', 24.26, 33.78, 10.98, 5.52),
    run('atm', 37.639, 25.8, 10.98, 18.2)];
  assert.equal(text(check(input)), '$\\frac{10}{3}atm$');
});

test('mass-only isotopes require a real element plus atomic context and keep neighbouring masses on the left', () => {
  const input = [prose('동위 원소', 0, 10, 10, 40), run('35', 20, 26, 6.8, 7), run('Cl', 27, 30, 10, 10),
    run('37', 38, 26, 6.8, 7), run('Cl', 45, 30, 10, 10)];
  assert.match(text(check(input)), /\$\{\}\^\{35\}Cl\{\}\^\{37\}Cl\$/);
  for (const item of ['f', 'AB', 'X', 'NaOH']) {
    assert.equal(check([input[0], run('18', 20, 26, 6.8, 7), run(item, 27, 30, 10, 10)])
      .events.filter(e => e.kind === 'isotopeMass').length, 0);
  }
  assert.equal(check(input.slice(1, 3)).events.filter(e => e.kind === 'isotopeMass').length, 0);
});

test('vector arrows attach to the indexed base without becoming orphan fractions', () => {
  const input = [run('─', 20, 24, 10, 10, { mathRole: 'fractionBar' }),
    run('→', 27, 24, 10, 5, { mathRole: 'vectorArrow' }),
    run('F', 20.2, 29, 10.5, 7), run('1', 27, 32, 6.8, 3.5)];
  for (const items of [input, input.toReversed()]) {
    const result = check(items);
    assert.equal(text(result), '$\\vec{F_{1}}$');
    assert.equal(result.warnings.length, 0);
  }
  const bareArrow = check([run('→', 27, 24, 10, 5, { mathRole: 'vectorArrow' }), run('F', 20, 40)]);
  assert.equal(bareArrow.events.filter(e => e.kind === 'vectorAccent').length, 0);
});

test('body-font parentheses around an equation preserve their own group subscript', () => {
  const input = [run('Z', 10, 30), prose('(', 15, 30.9, 11.5, 4), run('OH', 19, 30, 10.98, 16),
    prose(')', 35, 30.9, 11.5, 4), run('2', 39.3, 33.5, 7.5, 3.7)];
  assert.equal(text(check(input)), '$Z\\left(OH\\right)_{2}$');
});

// The user's exams remain outside the repository. These assertions exercise
// real geometry when explicitly supplied, without embedding any PDF or font.
test('all eight supplied science PDFs reconstruct audited scripts, vectors and fractions without losing choices', {
  skip: !process.env.MUNHANG_SCIENCE_AUDIT_DIR,
}, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dir = process.env.MUNHANG_SCIENCE_AUDIT_DIR;
  const files = fs.readdirSync(dir).filter(f => /^0[1-8].*\.pdf$/i.test(f)).sort();
  assert.equal(files.length, 8);
  const questionsBySubject = [];
  const fontRoleChecks = new Set();
  for (const file of files) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, file))),
      fontExtraProperties: true, cMapUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps/'), cMapPacked: true }).promise;
    try {
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p), vp = page.getViewport({ scale: 1 });
        const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
        const rules = pdfRules(ops, pdfjs.OPS, vp.transform);
        const extracted = extractPositionedText(content.items, vp.transform, ops, pdfjs.OPS, id => page.commonObjs.get(id), rules);
        if (fontRoleChecks.size < 3) for (const id of new Set(content.items.map(item => item.fontName).filter(Boolean))) {
          const font = page.commonObjs.get(id);
          if (!/(?:HyhwpEQ|HancomEQN)$/i.test(font.name ?? '') || !font.data) continue;
          const entries = Object.entries(font.toUnicode?._map ?? {});
          const glyph = char => {
            const entry = entries.find(([, value]) => value === char);
            return entry && String.fromCodePoint(font.toFontChar[Number(entry[0])]);
          };
          const decode = (char, fontChar, transform = [10, 0, 0, 10, 20, 50], suppliedFont = font) =>
            extractPositionedText([{ str: char, fontName: 'f', transform, width: 6 }], [1, 0, 0, -1, 0, 100],
              { fnArray: [1, 2], argsArray: [['f', 10], [[{ unicode: char, fontChar }]]] },
              { setFont: 1, showText: 2 }, () => suppliedFont).items.map(item => item.text).join('');
          if (!fontRoleChecks.has('roman') && glyph('C') && glyph('A')) {
            assert.equal(decode('C', glyph('C')), '$\\mathrm{C}$');
            assert.equal(decode('C', glyph('A')), 'C', 'semantic/outline mismatch must not supply roman metadata');
            assert.equal(decode('C', glyph('C'), undefined, { ...font, name: 'UnknownFont' }), 'C');
            fontRoleChecks.add('roman');
          }
          if (!fontRoleChecks.has('matrix') && glyph('\ue003')) {
            assert.equal(decode('\ue003', glyph('\ue003')), '$\\mathrm{D}$');
            assert.equal(decode('\ue003', glyph('\ue003'), [0, 10, -10, 0, 20, 50]), '$\\mathrm{D}$', 'rotation is not italic shear');
            assert.equal(decode('\ue003', glyph('\ue003'), [10, 0, 3.4, 10, 20, 50]), '$\\mathit{D}$');
            fontRoleChecks.add('matrix');
          }
          if (!fontRoleChecks.has('digits') && glyph('\ue035')) {
            assert.equal(decode('\ue035', glyph('\ue035')), '2');
            assert.equal(decode('2', glyph('\ue035')), '2');
            fontRoleChecks.add('digits');
          }
        }
        pages.push(layoutPage(extracted.items, vp.width, vp.height, p));
      }
      const questions = locateQuestions(pages);
      assert.deepEqual(questions.map(q => q.number), Array.from({ length: 20 }, (_, i) => i + 1), file);
      questionsBySubject.push(questions);
      for (const q of questions) for (const match of q.text.matchAll(/\$([^$]+)\$/g)) {
        assert.doesNotThrow(() => katex.renderToString(match[1], { throwOnError: true, strict: false }), `${file} q${q.number}`);
        assert.doesNotThrow(() => latexToOmml(match[1]), `${file} q${q.number}`);
        assert.doesNotThrow(() => latexToHwpxEquation(match[1], { id: 1 }), `${file} q${q.number}`);
      }
    } finally { await pdf.destroy(); }
  }
  assert.equal(fontRoleChecks.size, 3, 'all source-font guard checks ran against real supplied glyphs');
  const qRaw = (subject, number) => questionsBySubject[subject - 1].find(q => q.number === number).text;
  const q = (subject, number) => qRaw(subject, number).replace(/\\(?:mathrm|mathit)\{([^{}]*)\}/g, '$1');
  // Source-font roles are checked independently from mathematical content:
  // same-font ASCII atoms/units stay upright, verified PUA variables stay italic,
  // and the PDF matrix slants capital K/V/P without slanting their roman indices.
  assert.match(qRaw(2, 8), /\\mathrm\{A\}_\{2\}\\mathrm\{D\}/);
  assert.match(qRaw(2, 8), /\\mathrm\{B\}_\{2\}/);
  assert.match(qRaw(2, 9), /\\mathit\{n\}/); assert.match(qRaw(2, 9), /\\mathit\{l\}/);
  assert.match(qRaw(2, 13), /\\mathit\{K\}_\{\\mathrm\{w\}\}/);
  assert.match(qRaw(2, 15), /\\mathit\{a\}\\mathrm\{MnO\}\^\{−\}_\{4\}/);
  assert.match(qRaw(2, 15), /\\mathit\{d\}\\mathrm\{H\}_\{2\}\\mathrm\{O\}/);
  assert.match(qRaw(6, 13), /\\mathit\{K\}_\{\\mathrm\{a\}\}/);
  assert.match(qRaw(6, 14), /\\mathrm\{atm\}/);
  assert.match(qRaw(6, 14), /\\mathit\{V\}_\{\\mathrm\{II\}\}/);
  assert.match(qRaw(6, 15), /\\mathit\{k\} = 50\\mathit\{a\} \\mathrm\{s\}\^\{−1\}/);
  for (const variable of ['a', 'x', 'y']) assert.ok(qRaw(6, 15).includes(`\\mathit{${variable}}`));
  assert.match(qRaw(6, 16), /\\mathit\{P\} = 0\.5/);
  assert.match(qRaw(1, 15), /\\mathit\{f\}_\{1\}/);
  assert.match(qRaw(3, 1), /\\mathit\{β\}/);
  // These C labels actually use the source's explicitly named Italic body font.
  assert.match(qRaw(3, 9), /\\mathit\{C\}_\{1\}/);
  assert.match(qRaw(7, 16), /\\mathit\{w\}/);
  assert.match(qRaw(5, 4), /\\mathrm\{cal\}\/\\mathrm\{g\}\\cdot ℃/);
  assert.doesNotMatch(qRaw(5, 4), /℃\$\s*[·‧⋅]/);
  for (const variable of ['x', 'y']) assert.ok(qRaw(7, 20).includes(`\\mathit{${variable}}`));
  assert.match(q(1, 14), /0\.4t_\{0\}/); assert.match(q(1, 14), /0\.6t_\{0\}/);
  assert.match(q(1, 15), /f_\{1\}<\s*f_\{2\}/); assert.doesNotMatch(q(1, 15), /\{\}\^/);
  assert.equal((q(5, 1).match(/\\vec\{F_\{[12]\}\}/g) || []).length, 6);
  assert.match(q(5, 5), /\\frac\{1\}\{\\text\{주기\}\^\{2\}\}/);
  assert.match(q(2, 5), /\\frac\{a\}\{c\}/);
  assert.match(q(2, 17), /\{\}\^\{35\}Cl\{\}\^\{37\}Cl/);
  assert.match(q(2, 17), /\\frac\{\{\}\^\{35\}Cl_\{2\}/);
  assert.match(q(2, 20), /\\left\(OH\\right\)_\{2\}/);
  assert.match(q(6, 10), /\\frac\{80a\}\{81\}/);
  assert.match(q(6, 13), /10\^\{−\s*7\}/); assert.match(q(6, 13), /K_\{a\}/);
  assert.match(q(6, 14), /\\frac\{V_\{II\}\}\{V_\{I\}\}/);
  assert.match(q(6, 18), /\\frac\{3w\}\{4\}/);
  assert.equal((q(3, 14).match(/\\frac/g) || []).length, 7);
  assert.equal((q(3, 15).match(/\^\{\*\}/g) || []).length, 8);
  for (const gene of ['H', 'R', 'T']) assert.ok(q(3, 15).includes(`${gene}^{*}`));
  for (const n of [3, 7, 16]) assert.match(q(7, n), /_\{[1-5]\}/);
  assert.match(q(7, 12), /\\frac\{㉠/);
  assert.match(q(7, 14), /\{\}\^\{18\}O_\{2\}/);
  assert.match(q(4, 15), /\\frac\{A\\text\{의 비율\}\}\{C\\text\{의 비율\}\}/);
  assert.doesNotMatch(q(8, 4), /\\frac/);
  assert.match(q(8, 4), /큰 스타이로폼 공 4 개와 작은/);
  assert.match(q(8, 4), /규산염 사면체 모형 여러 개를/);
});
