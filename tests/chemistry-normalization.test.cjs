/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { normalizeQuestionText: normalize, splitMathText } = require('../lib/math-normalization.ts');

test('chemistry context makes molecule letters upright without changing scripts or charges', () => {
  const formulae = ['CO_2', 'H_2CO_3', 'HCO^{-}_3', 'CO^{2-}_3', 'CaCO_3', 'CO_{2}', 'HCO^{−}_{3}', 'CO^{2−}_{3}'];
  for (const formula of formulae) {
    const result = normalize(`탄산 이온의 화학식 $${formula}$이다.`);
    assert.equal(result, `탄산 이온의 화학식 $\\mathrm{${formula}}$이다.`);
    assert.equal(normalize(result), result);
    const math = splitMathText(result).find((part) => part.math).text;
    assert.doesNotThrow(() => katex.renderToString(math, { throwOnError: true }));
  }
});

test('reaction operators and split reaction fragments retain their order', () => {
  const source = String.raw`화학 반응식 $CO_{2}+H_{2}O→H_{2}CO_{3}$, $H_{2}CO_{3}→$ ㉠ $+HCO^{−}_{3}$`;
  const expected = String.raw`화학 반응식 $\mathrm{CO_{2}}+\mathrm{H_{2}O}→\mathrm{H_{2}CO_{3}}$, $\mathrm{H_{2}CO_{3}}→$ ㉠ $+\mathrm{HCO^{−}_{3}}$`;
  assert.equal(normalize(source), expected);
  assert.equal(normalize(expected), expected);
});

test('grouped molecules become upright with their parentheses and scripts intact', () => {
  const source = String.raw`화학 반응식 $+Ca\left(OH\right)_{2}→CaCO_{3}+H_{2}O$`;
  const expected = String.raw`화학 반응식 $+\mathrm{Ca\left(OH\right)_{2}}→\mathrm{CaCO_{3}}+\mathrm{H_{2}O}$`;
  assert.equal(normalize(source), expected);
  assert.equal(normalize(expected), expected);
  assert.doesNotThrow(() => katex.renderToString(splitMathText(expected).find((part) => part.math).text, { throwOnError: true }));
  assert.equal(normalize(String.raw`용액의 $Ca(OH)_2$와 $Al(OH)_{3}$`), String.raw`용액의 $\mathrm{Ca(OH)_2}$와 $\mathrm{Al(OH)_{3}}$`);
});

test('normal mathematics, geometry labels, genetic notation, and explicit fonts stay unchanged', () => {
  const examples = [
    String.raw`물체 A와 B의 속력 $v_A$, $v_B$, $v_B=2v_A$`,
    String.raw`$CO_2$와 $C_2$는 수학 변수이다.`,
    String.raw`화학 자료의 삼각형 $ABC$, 벡터 $\overline{CO_2}$와 $v_A$, $C_2$`,
    String.raw`유전자와 이온 농도의 관계에서 $CO_2$, $BRCA_1$, $NF_1$을 비교한다.`,
    String.raw`화학식 $\mathrm{CO_2}$, $\mathit{H_2O}$, $\text{CaCO_3}$`,
    String.raw`이온 표기의 변수 $ABC_2$, $BRCA_1$`,
    String.raw`화학 자료의 $x\left(y+z\right)^2$, $A\left(BC\right)_{2}$, $\left(CO\right)_2$`,
    String.raw`$Ca\left(OH\right)_{2}$에는 문맥이 없다.`,
    String.raw`화학식 $\mathit{Ca\left(OH\right)_2}$와 $\mathrm{Ca(OH)_2}$`,
    String.raw`화학 자료의 선분 $\overline{Ca\left(OH\right)_2}$`,
  ];
  for (const source of examples) {
    // Existing normalization intentionally unwraps prose-only \text labels.
    const expected = source.replace(String.raw`$\text{CaCO_3}$`, 'CaCO_3');
    assert.equal(normalize(source), expected);
  }
});

test('literal newlines before Korean and circle list markers become prose line breaks', () => {
  const source = String.raw`:::box
ㅇ 첫째 조건이다.\nㅇ 둘째 조건이다.\n◦ 셋째 조건이다.
:::
:::box <보기>
ㄱ. 첫째 설명이다.\nㄴ . 둘째 설명이다.\nㄷ 셋째 설명이다.
:::`;
  const expected = source.replace(/\\n/g, '\n');
  assert.equal(normalize(source), expected);
  assert.equal(normalize(expected), expected);
});

test('real TeX commands, environment row breaks, code and quoted escapes remain intact', () => {
  const examples = [
    String.raw`$\nu \neq \nabla f$`,
    String.raw`$\begin{cases}n&n>0\\n+1&n≤0\end{cases}$`,
    String.raw`$\begin{aligned}a&=b\\n&=2\end{aligned}$`,
    'const value = "a\\nㅇ b";',
    "const value = 'a\\nㄱ. b';",
    '`a\\nㅇ b`',
    '```js\nconst value = "a\\nㅇ b";\n```',
    String.raw`경로 C:\notes\new, 이중 이스케이프 \\nㅇ 항목`,
    String.raw`알 수 없는 \n문자와 \name 명령`,
    '항목\t값\nA\t2',
  ];
  for (const source of examples) assert.equal(normalize(source), source);
});
