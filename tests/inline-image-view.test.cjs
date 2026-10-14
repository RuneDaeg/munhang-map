/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const MathText = require('../components/math-text.tsx').default;

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FVcAAAAASUVORK5CYII=';
const images = [{ id: 'image1', image: png, label: '첫 그림' }, { id: 'image2', image: png, label: '둘째 그림' }];
const render = (text, sourceImages, extra = {}) => renderToStaticMarkup(React.createElement(MathText, { text, sourceImages, ...extra }));
const occurrences = (text, regex) => [...text.matchAll(regex)].length;

test('screen puts images between adjacent text and math at every marker occurrence', () => {
  const text = '앞 $x^{2}$ [삽입 그림: image1] 중간 [삽입 그림: image2] 다음 [삽입 그림: image1] 끝';
  for (const compact of [false, true]) {
    const html = render(text, images, { compact });
    assert.equal(occurrences(html, /<img\b/g), 3);
    assert.deepEqual([...html.matchAll(/data-source-image-id="([^"]+)"/g)].map(match => match[1]), ['image1', 'image2', 'image1']);
    assert.ok(html.indexOf('앞') < html.indexOf('data-source-image-id="image1"'));
    assert.ok(html.indexOf('data-source-image-id="image1"') < html.indexOf('중간'));
    assert.ok(html.indexOf('중간') < html.indexOf('data-source-image-id="image2"'));
    assert.ok(html.lastIndexOf('data-source-image-id="image1"') < html.indexOf('끝'));
    assert.match(html, /katex/);
    assert.doesNotMatch(html, /\[삽입 그림:|위치 미지정/);
  }
});

test('screen preserves bold and underline around local inline images', () => {
  const html = render('<b>굵게 [삽입 그림: image1] 계속</b> <u>밑줄 $x^{2}$ [삽입 그림: image2] 끝</u>', images);
  assert.match(html, /<strong>[\s\S]*data-source-image-id="image1"[\s\S]*계속[\s\S]*<\/strong>/);
  assert.match(html, /<u>[\s\S]*katex[\s\S]*data-source-image-id="image2"[\s\S]*끝[\s\S]*<\/u>/);
  assert.doesNotMatch(html, /\[삽입 그림:/);
});

test('nested boxes and table titles, headers and cells use the same image context', () => {
  const text = ':::box 바깥 [삽입 그림: image1]\n처음\n:::box 안쪽\n[삽입 그림: image2]\n:::\n:::table 제목 [삽입 그림: image1]\n| 머리 [삽입 그림: image2] | 값 |\n| --- | --- |\n| [삽입 그림: image1] | $x_1$ |\n:::\n끝\n:::';
  const html = render(text, images);
  assert.equal(occurrences(html, /<section\b/g), 2);
  assert.equal(occurrences(html, /<table\b/g), 1);
  assert.equal(occurrences(html, /<img\b/g), 5);
  assert.match(html, /<caption\b[\s\S]*data-source-image-id="image1"[\s\S]*<\/caption>/);
  assert.match(html, /<th\b[\s\S]*data-source-image-id="image2"[\s\S]*<\/th>/);
  assert.match(html, /<td\b[\s\S]*data-source-image-id="image1"[\s\S]*<\/td>/);
  assert.doesNotMatch(html, /\[삽입 그림:|위치 미지정/);
});

test('unreferenced images are retained once with a visible location warning outside nested boxes', () => {
  const text = ':::box 바깥\n[삽입 그림: image1]\n:::box 안쪽\n본문\n:::\n:::';
  const html = render(text, images);
  assert.equal(occurrences(html, /<img\b/g), 2);
  assert.equal(occurrences(html, /위치 미지정 삽입 그림/g), 1);
  assert.equal(occurrences(html, /data-source-image-id="image2"/g), 1);
  assert.ok(html.lastIndexOf('</section>') < html.indexOf('위치 미지정'));
  assert.match(html, /\[삽입 그림: image2\]/);
});

test('HWPX missing IDs display an accessible warning at their position', () => {
  const html = render('앞 [삽입 그림: lost] 뒤', []);
  assert.match(html, /role="alert"[^>]*>삽입 그림 누락: lost/);
  assert.ok(html.indexOf('앞') < html.indexOf('삽입 그림 누락'));
  assert.ok(html.indexOf('삽입 그림 누락') < html.indexOf('뒤'));
  assert.doesNotMatch(html, /<img\b/);
});

test('PDF or plain text context keeps marker prose unchanged without an image lookup', () => {
  const html = render('앞 [삽입 그림: image1] 뒤');
  assert.match(html, /\[삽입 그림: image1\]/);
  assert.doesNotMatch(html, /<img\b|role="alert"/);
});

test('remote and SVG images are rejected before any img src can reach the DOM', () => {
  for (const image of ['https://example.invalid/private.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'javascript:alert(1)']) {
    const html = render('[삽입 그림: image1]', [{ id: 'image1', image }]);
    assert.match(html, /role="alert"/);
    assert.match(html, /데이터가 올바르지 않아/);
    assert.doesNotMatch(html, /<img\b|src=|example\.invalid|svg\+xml|javascript:/);
  }
});

test('duplicate IDs cannot silently bind the wrong image and labels remain escaped', () => {
  const invalid = render('[삽입 그림: image1]', [images[0], images[0]]);
  assert.match(invalid, /데이터가 올바르지 않아/);
  assert.doesNotMatch(invalid, /<img\b/);
  const html = render('[삽입 그림: image1]', [{ ...images[0], label: '" onerror="alert(1)<script>' }]);
  assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)&lt;script&gt;"/);
  assert.doesNotMatch(html, / onerror="|<script>/);
});

test('image resolution remains per question or explanation without modifying stored markers', () => {
  const text = '[삽입 그림: image1]';
  const body = [{ ...images[0], label: '본문 그림' }];
  const explanation = [{ ...images[0], label: '해설 그림' }];
  const before = JSON.stringify({ text, body, explanation });
  assert.match(render(text, body), /alt="본문 그림"/);
  assert.match(render(text, explanation), /alt="해설 그림"/);
  assert.doesNotMatch(render(text, []), /alt="(?:본문|해설) 그림"/);
  assert.equal(JSON.stringify({ text, body, explanation }), before);
});

test('main and bank previews provide source contexts rather than duplicate trailing galleries', () => {
  const page = fs.readFileSync(path.join(__dirname, '../app/page.tsx'), 'utf8');
  const bank = fs.readFileSync(path.join(__dirname, '../components/question-bank.tsx'), 'utf8');
  assert.match(page, /<MathText text=\{question\.text\} compact sourceImages=/);
  assert.match(page, /<MathText text=\{question\.text\} sourceImages=/);
  assert.match(page, /<MathText text=\{question\.explanation \?\? ''\} sourceImages=/);
  assert.match(bank, /<MathText text=\{previewDraft\} sourceImages=/);
  assert.match(bank, /<MathText text=\{preview\.text\} sourceImages=/);
  assert.match(bank, /<MathText text=\{preview\.explanation \?\? ''\} sourceImages=/);
  assert.doesNotMatch(page + bank, /(?:sourceImages|explanationImages)\?\.map/);
});
