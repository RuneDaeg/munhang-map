/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const MathText = require('../components/math-text.tsx').default;

test('the shared app footer retains the creator credit and the MIT licence notice', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
  const footer = source.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer);
  assert.ok(footer.includes('제작자: 여광재(온양고등학교)'));
  assert.ok(footer.includes('MIT 라이선스'));
  assert.doesNotMatch(footer, /무단 전제|무단 전재/);
  assert.ok(footer.includes('데이터 출처'));
  assert.ok(footer.includes('HWPX 구현 참고'));
});

test('list and detail markup render symbols and formulae, while escaping non-math HTML', () => {
  const text = String.raw`\bullet 부리 크기 $L$와 \frac{a}{b} <img src=x onerror=alert(1)>`;
  for (const compact of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(MathText, { text, compact }));
    assert.match(html, /• 부리 크기/);
    assert.match(html, /class="katex"/);
    assert.doesNotMatch(html, /\\bullet|\$L\$|<img/);
    assert.match(html, /&lt;img/);
    assert.ok(html.startsWith('<div'));
  }
});

test('inspector source declares viewport-limited sticky layout and resets its body on selection', () => {
  const css = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
  assert.match(css, /@media \(min-width: 80rem\)/);
  const container = css.match(/\.question-inspector\s*\{([^}]+)\}/)[1];
  for (const rule of ['position: sticky', 'top: 5rem', 'align-self: start', 'max-height: calc(100dvh - 6rem)']) assert.ok(container.includes(rule));
  const body = css.match(/\.question-inspector-body\s*\{([^}]+)\}/)[1];
  assert.match(body, /min-height: 0/); assert.match(body, /overflow-y: auto/);
  assert.ok(source.includes('<QuestionInspector key={`${fileName}-${selected}`}'));
  assert.match(source, /\{question.number\}번 문항 정보/);
  assert.match(source, /question-inspector-body[^\n]+tabIndex=\{0\}/);
  assert.ok(source.indexOf('문항 미리보기 · 수식·표·보기') < source.indexOf('<QuestionTextEditor ref={textRef}'));
  assert.match(source, /상자 \$\{boxCount\}개/);
});

test('central list keeps the same nested boxes, tables and formatting as the inspector without clamping', () => {
  const text=String.raw`앞 발문 $a_1=5$
:::box 조건
<b>첫 조건</b>과 <u>밑줄</u>
:::table 결과
| A | B | C | D | E |
| --- | --- | --- | --- | --- |
| $|x|$ | 2 | 3 | 4 | 마지막 열 |
:::
:::
중간 발문
:::box 풀이
$\sum_{k=1}^{5}a_k$의 값이다.
:::
끝 발문 ① 1 ② 2 ③ 3 ④ 4 ⑤ 5`;
  for(const compact of [true,false]) {
    const html=renderToStaticMarkup(React.createElement(MathText,{text,compact}));
    assert.equal((html.match(/<section\b/g)||[]).length,2);
    assert.equal((html.match(/<table\b/g)||[]).length,1);
    assert.equal((html.match(/scope="col"/g)||[]).length,5);
    assert.match(html,/<strong>/);assert.match(html,/<u>/);
    assert.match(html,/tabindex="0"/);assert.match(html,/overflow-x-auto/);
    assert.match(html,/border-foreground\/60/);
    assert.doesNotMatch(html,/:::|katex-error|line-clamp/);
    const fragments=['앞 발문','첫 조건','마지막 열','중간 발문','끝 발문'];
    for(let i=1;i<fragments.length;i++) assert.ok(html.indexOf(fragments[i-1])<html.indexOf(fragments[i]));
    assert.equal((html.match(/마지막 열/g)||[]).length,1);
  }
  const source=fs.readFileSync(path.join(__dirname,'../app/page.tsx'),'utf8');
  const row=source.match(/<article key=\{`\$\{question.number\}-\$\{index\}`\}[\s\S]*?<\/article>/)?.[0];
  assert.ok(row,'semantic list row');
  assert.match(row,/aria-pressed=\{selected === index\}/);
  assert.match(row,/data-question-preview[^>]*tabIndex=\{0\}/);
  assert.match(row,/overflow-x-auto/);
  assert.doesNotMatch(row,/line-clamp/);
  assert.ok(row.indexOf('</button>')<row.indexOf('<MathText'),'preview is not nested in the selection button');
});
