/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createQuestionBank } = require('../local/question-bank.cjs');
const { questionStorageProblem } = require('../lib/question-storage-check.ts');
const { saveToQuestionBank, loadBankItem, updateBankItem } = require('../lib/question-bank.ts');
const image = 'data:image/jpeg;base64,/9j/2Q==';
const q = { number: 1, type: 'test', text: '$x^2$', standardCode: '[manual]', standard: '교사 선택', domain: '수학', confidence: 80,
  questionCaptures: [{ page: 1, box: [0, 0, .5, .5], image }], visualChoices: [{ label: '①', page: 1, box: [0, 0, .2, .1], image }],
  sharedPassage: { range: [1, 2], text: '공통 지문', pages: [1] }, assessmentText: '이전 발문', mappingReason: '이전 근거', validationFlags: [{ code: 'latex_unbalanced', message: '이전 경고' }], captureReviewed: true, visionEnhanced: true };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-edit-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bank = createQuestionBank(root);
  bank.save({ sourceFileName: 'exam.pdf', sourceFingerprint: 'a'.repeat(64), questions: [q, { ...q, number: 2 }] });
  return { root, bank, ids: bank.list().map(i => i.id) };
}
test('single-question update preserves sibling, ID, captures, context and teacher mapping after restart', t => {
  const { bank, root, ids } = fixture(t), entry = bank.inspect(ids[0]), sibling = bank.inspect(ids[1]);
  const updated = bank.update({ id: entry.id, revision: entry.revision, text: '$x^3$', questionCaptures: [], standardCode: '[evil]', apiKey: 'secret' });
  assert.equal(updated.id, entry.id); assert.notEqual(updated.revision, entry.revision);
  const reopened = createQuestionBank(root);
  assert.deepEqual(reopened.inspect(ids[1]), sibling);
  assert.equal(reopened.inspect(ids[0]).question.text, '$x^3$');
  for (const key of ['questionCaptures', 'visualChoices', 'sharedPassage', 'standardCode', 'standard', 'domain', 'captureReviewed']) assert.deepEqual(updated.question[key], q[key]);
  for (const key of ['assessmentText', 'mappingReason', 'validationFlags', 'apiKey']) assert.equal(updated.question[key], undefined);
  assert.equal(updated.question.textEdited, true); assert.equal(updated.question.visionEnhanced, false);
  assert.equal(reopened.list()[0].text, '$x^3$');
});
test('stale writes fail without changing current text; edits of a different sibling are merged', t => {
  const { bank, ids } = fixture(t), a = bank.inspect(ids[0]), b = bank.inspect(ids[1]);
  bank.update({ ...a, text: 'first' });
  assert.throws(() => bank.update({ ...a, text: 'stale' }), /덮어쓰지/);
  bank.update({ ...b, text: 'second' });
  assert.deepEqual(bank.select(ids).map(q => q.text), ['first', 'second']);
});
test('write failure and same-source lock preserve old content and index', t => {
  const { root, bank, ids } = fixture(t), a = bank.inspect(ids[0]);
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('disk failed'); };
    assert.throws(() => bank.update({ ...a, text: 'not saved' }), /disk failed/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(bank.inspect(ids[0]), a); assert.equal(fs.readdirSync(root).length, 1);
  const lock = path.join(root, `${ids[0].split(':')[0]}.jsonl.lock`);
  fs.writeFileSync(lock, 'other process');
  assert.throws(() => bank.update({ ...a, text: 'race' }), /진행 중/);
  assert.deepEqual(bank.inspect(ids[0]), a);
});
test('update rejects path traversal, empty or oversized text and invalid revisions', t => {
  const { bank, ids } = fixture(t), a = bank.inspect(ids[0]);
  for (const patch of [{ id: '../../settings' }, { revision: 'bad' }, { text: '' }, { text: 'x'.repeat(200001) }]) assert.throws(() => bank.update({ ...a, text: 'valid', ...patch }), /올바르지/);
});
test('storage preflight accepts valid math, tables, boxed labels, whole-math underline and prose prices', () => {
  for (const text of [String.raw`$\frac{1}{2}$`, String.raw`$10^{-27}$`, '$' + String.raw`{}^{2}_{1}\mathrm{H}$`, String.raw`$f_1<f_2$`, '<u>$x^2$</u>', '가격 $5와 $10', ':::box <보기>\nㄱ. $x^2$\n:::', '| 제목 | 식 |\n| --- | --- |\n| a | $x^2$ |', String.raw`$\boxed{\text{㉠}}$`]) assert.equal(questionStorageProblem(text), null, text);
});
test('storage preflight rejects broken LaTeX in body, nested table and partial math formatting', () => {
  for (const text of [String.raw`$\notACommand{x}$`, String.raw`$x^{2$`, String.raw`$\frac{1}{2}`, ':::box 자료\n| 이름 | 값 |\n| --- | --- |\n| a | $x^{2$ |\n:::', '$x<u>^2$</u>', '문항 x^{2}', String.raw`\(x^{2}`, String.raw`\frac{x}{`, String.fromCharCode(8) + 'igg(x)']) assert.ok(questionStorageProblem(text), text);
});
test('browser save and edit reject invalid math before sending any request', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  let calls = 0; global.fetch = async () => { calls++; throw Error('must not call'); };
  await assert.rejects(saveToQuestionBank('exam.pdf', [{ ...q, text: '$x^{2$' }], ['private page']), /1번/);
  await assert.rejects(updateBankItem({ id: 'x', revision: 'y', question: q }, '$x^{2$'), /1번/);
  assert.equal(calls, 0);
});
test('client edit reads legacy broken math and sends only text, ID and revision after correction', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const entry = { id: `${'a'.repeat(64)}:${'b'.repeat(64)}`, revision: 'c'.repeat(64), question: { ...q, text: '$x^{2$' } };
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/item')) { assert.deepEqual(body, { id: entry.id }); return Response.json(entry); }
    assert.equal(url, '/api/question-bank/update');
    assert.deepEqual(body, { id: entry.id, revision: entry.revision, text: '$x^2$' });
    return Response.json({ ...entry, question: { ...q, text: body.text } });
  };
  const loaded = await loadBankItem(entry.id); assert.equal(loaded.question.text, entry.question.text);
  assert.equal((await updateBankItem(loaded, '$x^2$')).question.text, '$x^2$');
});
