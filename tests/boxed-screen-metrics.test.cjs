/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const MathText = require('../components/math-text.tsx').default;
const { latexToOmml } = require('../lib/docx-math.ts');
const { latexToHwpScript } = require('../lib/hwpx-math.ts');

test('fallback circled box labels reserve visible screen height without native phantom content', () => {
  for (const label of ['㉠', '㉡', 'ⓐ', 'ㄱ', '①']) {
    const latex = `\\boxed{\\text{${label}}}`;
    const html = renderToStaticMarkup(React.createElement(MathText, { text: `$${latex}$` }));
    assert.doesNotMatch(html, /katex-error/);
    const height = Number(html.match(/class="katex-stretchy fbox" style="height:([\d.]+)em/)[1]);
    assert.ok(height > 1.3, `box must contain ${label}, not cross its baseline`);
    assert.match(latexToOmml(latex), /<m:borderBox>/);
    assert.ok(latexToHwpScript(latex).includes(label));
    assert.doesNotMatch(latexToOmml(latex), /Hg|phantom/);
    assert.doesNotMatch(latexToHwpScript(latex), /Hg|phantom/);
  }
  const normal = renderToStaticMarkup(React.createElement(MathText, { text: '$\\boxed{x^2}$' }));
  assert.doesNotMatch(normal, /phantom|katex-error/);
});

test('source-underlined math gets its own screen underline, not a full-width row border', () => {
  const source = '<u>${}^{18}\\mathrm{O}$</u> <u>로</u>\n<u>표지된 물</u> $x$';
  const html = renderToStaticMarkup(React.createElement(MathText, { text: source }));
  assert.equal((html.match(/inline-block border-b border-current/g) || []).length, 1);
  assert.match(html, /표지된 물/);
  assert.doesNotMatch(html, /katex-error/);
  const display = renderToStaticMarkup(React.createElement(MathText, { text: '<u>$$x^2$$</u>' }));
  assert.equal((display.match(/inline-block border-b border-current/g) || []).length, 1);
});
