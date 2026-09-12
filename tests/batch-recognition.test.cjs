/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { recognizeQuestionBatch } = require('../lib/batch-recognition.ts');
const questions = () => [1, 2, 3].map(number => ({ number, text: `source ${number}`, questionCaptures: [{ image: 'capture' }] }));
const reply = source => ({ questions: [{ ...source, text: 'updated ' + source.number }], failures: [], warnings: [] });

test('explicit batch submits each captured question once, sequentially, preserving source identity', async () => {
  const source = questions(), calls = [], progress = [];
  let active = 0;
  const result = await recognizeQuestionBatch(source, { shouldStop: () => false, onProgress: p => progress.push(p), recognize: async batch => {
    assert.equal(active++, 0); assert.equal(batch.length, 1); calls.push(batch[0].number);
    await Promise.resolve(); active--; return reply(batch[0]);
  } });
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(result.completed, 3); assert.equal(result.attempted, 3);
  assert.equal(result.updates[0].source, source[0]); assert.equal(source[0].text, 'source 1');
  assert.equal(progress.at(-1).completed, 3); assert.equal(result.stopped, false);
});
test('stop retains in-flight response but never starts the next question', async () => {
  let stop = false;
  const result = await recognizeQuestionBatch(questions(), { shouldStop: () => stop, onProgress: () => {}, recognize: async batch => { stop = true; return reply(batch[0]); } });
  assert.equal(result.completed, 1); assert.equal(result.attempted, 1); assert.equal(result.stopped, true);
  assert.equal(result.updates[0].question.number, 1);
});
test('already stopped job makes zero paid calls', async () => {
  const result = await recognizeQuestionBatch(questions(), { shouldStop: () => true, onProgress: () => {}, recognize: async () => assert.fail('No call') });
  assert.equal(result.attempted, 0); assert.equal(result.stopped, true);
});
test('failure halts further calls and keeps successful results and warnings', async () => {
  const result = await recognizeQuestionBatch(questions(), { shouldStop: () => false, onProgress: () => {}, recognize: async ([q]) => q.number === 1 ? { ...reply(q), warnings: ['확인 필요'] } : { questions: [q], failures: ['budget exhausted'], warnings: [] } });
  assert.equal(result.completed, 1); assert.equal(result.attempted, 2); assert.equal(result.updates.length, 1);
  assert.deepEqual(result.warnings, ['확인 필요']); assert.match(result.failures[0], /2번.*budget/);
});
test('wrong question response cannot replace a source, and thrown network errors halt the batch', async () => {
  for (const recognize of [async () => reply({ number: 99 }), async () => { throw new Error('network unavailable'); }]) {
    const result = await recognizeQuestionBatch(questions(), { shouldStop: () => false, onProgress: () => {}, recognize });
    assert.equal(result.attempted, 1); assert.equal(result.updates.length, 0); assert.equal(result.failures.length, 1);
  }
});
test('preflight blocks incomplete capture sets, empty and oversized exams without fallback', async () => {
  const absent = questions(); absent[1] = { ...absent[1], questionCaptures: [], sourcePageImage: 'whole page must not be sent' };
  for (const source of [absent, [], Array.from({ length: 201 }, () => questions()[0])])
    await assert.rejects(recognizeQuestionBatch(source, { shouldStop: () => false, onProgress: () => {}, recognize: async () => assert.fail('No paid call') }));
});
