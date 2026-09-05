/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { dragCaptureBox, setCaptureEdge, validCaptureBox } = require('../lib/capture-editor.ts');
const { serializeReview, parseReview } = require('../lib/review-file.ts');
const { layoutPage, locateQuestions } = require('../lib/pdf-layout.ts');

test('dragging clamps to the page while preserving size; drawing works in either direction', () => {
  assert.deepEqual(dragCaptureBox([0.1, 0.2, 0.4, 0.3], [0.2, 0.3], [1, 1], 'move'), [0.6, 0.7, 0.4, 0.3]);
  const box = dragCaptureBox([0, 0, 1, 1], [0.8, 0.9], [0.1, 0.2], 'draw');
  assert.ok(Math.abs(box[2] - 0.7) < 0.00001 && Math.abs(box[3] - 0.7) < 0.00001);
  assert.ok(validCaptureBox(box));
});

test('resize handles and keyboard fields cannot invert or move unrelated edges', () => {
  const box = [0.1, 0.2, 0.4, 0.3];
  assert.deepEqual(setCaptureEdge(box, 'right', 0.8), [0.1, 0.2, 0.7000000000000001, 0.3]);
  const resized = dragCaptureBox(box, [0.1, 0.2], [1, 1], 'nw');
  assert.ok(resized[2] > 0 && resized[3] > 0);
  assert.ok(Math.abs(resized[0] + resized[2] - 0.5) < 0.00001);
  assert.equal(validCaptureBox([0, 0, 0, 0]), false);
  assert.equal(validCaptureBox([0, 0, Infinity, 1]), false);
  assert.equal(validCaptureBox([0.8, 0, 0.5, 1]), false);
});

test('the centered page-number footer is excluded without clipping the last choices', () => {
  const row = (text, x, y, width) => ({ text, x, y, width, height: 10 });
  const page = layoutPage([row('1. 첫 문항', 30, 100, 200), row('① 선택 ② 선택 ③ 선택', 30, 710, 230), row('1 6', 284, 745, 32)], 600, 800, 1);
  const question = locateQuestions([page])[0];
  const [, top, , height] = question.regions[0].box;
  assert.ok((top + height) * 800 > 720 && (top + height) * 800 < 745);
  assert.doesNotMatch(question.text, /1 6/);
});

test('review serialization excludes key-like extra fields and stores editable boxes', () => {
  const question = { number: 1, type: 'test', text: '문항', standardCode: '', standard: '', domain: '', confidence: 35, captureReviewed: true, sourcePageImage: 'page', apiKey: 'must-not-be-exported', questionCaptures: [{ page: 1, box: [0.1, 0.2, 0.4, 0.3], image: 'crop' }] };
  const serialized = serializeReview('exam.pdf', [question], ['page']);
  assert.doesNotMatch(serialized, /must-not-be-exported|apiKey|crop/);
  const data = JSON.parse(serialized);
  assert.equal(data.questions[0].captureReviewed, true);
  assert.deepEqual(data.questions[0].regions[0].box, [0.1, 0.2, 0.4, 0.3]);
});

test('untrusted review files cannot load remote images or out-of-page regions', async () => {
  await assert.rejects(parseReview(JSON.stringify({ format: 'munhang-map-review', version: 1, fileName: 'x', sourcePages: ['https://example.com/image.jpg'], questions: [{}] })), /검토 파일/);
  const question = { number: 1, type: 'test', text: '문항', standardCode: '', standard: '', domain: '', confidence: 35, sourcePage: 1, regions: [{ page: 1, box: [0.8, 0.8, 0.5, 0.5] }] };
  await assert.rejects(parseReview(JSON.stringify({ format: 'munhang-map-review', version: 1, fileName: 'x', sourcePages: ['data:image/jpeg;base64,/9j/2Q=='], questions: [question] })), /캡처 범위/);
});
