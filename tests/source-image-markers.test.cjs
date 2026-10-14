/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSourceImageMarkers, referencedSourceImageIds } = require('../lib/source-image-markers.ts');

test('source image markers preserve text order, IDs and every repeated occurrence', () => {
  const text = '앞 $x_1$ [삽입 그림: img-1] 사이 [삽입 그림: img.2]\n[삽입 그림: img-1] 끝';
  const parts = splitSourceImageMarkers(text);
  assert.deepEqual(parts.filter(p => p.kind === 'image').map(p => p.id), ['img-1', 'img.2', 'img-1']);
  assert.equal(parts.map(p => p.kind === 'image' ? p.marker : p.text).join(''), text);
  assert.deepEqual([...referencedSourceImageIds(text)], ['img-1', 'img.2']);
});

test('only bounded explicit safe IDs can reference images; ordinary placeholder prose remains', () => {
  for (const text of ['', '[삽입 그림]', '[삽입 그림: .]', '[삽입 그림: ..]', '[삽입 그림: ../../x]', '[삽입 그림: https://x]', '[삽입 그림: <x>]', `[삽입 그림: ${'a'.repeat(101)}]`]) {
    assert.deepEqual(splitSourceImageMarkers(text), [{kind:'text', text}]);
  }
  assert.deepEqual([...referencedSourceImageIds('[삽입 그림:  img_1 ]')], ['img_1']);
});

test('box and table delimiters are not consumed by image marker tokenization', () => {
  const text = ':::box 보기\n[삽입 그림: img1]\n:::table\n| 이름 | [삽입 그림: img2] |\n:::\n:::';
  const parts=splitSourceImageMarkers(text);
  assert.equal(parts.map(p => p.kind === 'image' ? p.marker : p.text).join(''), text);
  assert.deepEqual([...referencedSourceImageIds(text)], ['img1','img2']);
});
