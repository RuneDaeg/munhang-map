/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createQuestionBank } = require('../local/question-bank.cjs');
const { saveToQuestionBank, listBankItems, loadBankSelection } = require('../lib/question-bank.ts');
const image = 'data:image/jpeg;base64,/9j/2Q==';
const question = { number: 1, type: 'test', text: '원문', standardCode: '[12통과01-01]', standard: '성취기준', domain: '고등학교 · 통합과학1', confidence: 85, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image }], apiKey: 'must-not-save', sourcePageImage: 'must-not-save-full-page' };
const input = (fileName = 'exam.pdf', questions = [question]) => ({ sourceFileName: fileName, sourceFingerprint: 'a'.repeat(64), questions, apiKey: 'must-not-save' });
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-bank-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('shared passage, own assessment and validation reasons survive bank and review round trips',async(t)=>{
  const root=fixture(t),context={assessmentText:'1. 개별 발문?',sharedPassage:{range:[1,3],text:'공유 지문',pages:[1]},mappingArea:'읽기',mappingReason:'발문 근거',validationFlags:[{code:'code_overused',message:'대조 필요'}]};
  createQuestionBank(root).save(input('context.pdf',[{...question,...context}]));
  const bank=createQuestionBank(root),restored=bank.select(bank.list().map(i=>i.id))[0];
  const {serializeReview,parseReview}=require('../lib/review-file.ts');
  const oldImage=global.Image,oldDocument=global.document;
  t.after(()=>{global.Image=oldImage;global.document=oldDocument;});
  global.Image=class {naturalWidth=100;naturalHeight=100;set src(value){queueMicrotask(()=>this.onload());}};
  global.document={createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>image})};
  const review=await parseReview(serializeReview('context.pdf',[restored],[image]));
  for(const key of Object.keys(context))assert.deepEqual(review.questions[0][key],context[key]);
});

test('disk persistence survives restarts; repeated saves update and two PDFs keep the same question number', (t) => {
  const root = fixture(t);
  let bank = createQuestionBank(root);
  assert.deepEqual(bank.list(), []);
  assert.deepEqual(bank.save(input()), { saved: 1, updated: false });
  const firstId = bank.list()[0].id;
  bank = createQuestionBank(root);
  assert.equal(bank.select([firstId])[0].questionCaptures[0].image, image);
  assert.deepEqual(bank.save(input('exam.pdf', [{ ...question, text: '수정됨', standardCode: '[changed]' }])), { saved: 1, updated: true });
  bank.save(input('second.pdf'));
  assert.equal(bank.list().length, 2);
  const secondId = bank.list().find((row) => row.sourceFileName === 'second.pdf').id;
  const selected = bank.select([secondId, firstId]);
  assert.deepEqual(selected.map((item) => item.number), [1, 1]);
  assert.deepEqual(selected.map((item) => item.sourceFileName), ['second.pdf', 'exam.pdf']);
  assert.equal(selected[1].text, '수정됨');
  assert.equal(selected[1].standardCode, '[changed]');
  for (const file of fs.readdirSync(root)) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /apiKey|must-not-save/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
  }
});

test('bad IDs, remote images, out-of-page boxes and duplicate selections cannot access the bank', (t) => {
  const bank = createQuestionBank(fixture(t));
  assert.throws(() => bank.save({ ...input(), sourceFingerprint: '../../settings' }), /올바르지/);
  assert.throws(() => bank.save(input('exam.pdf', [{ ...question, questionCaptures: [{ page: 1, box: [0, 0, 1, 1], image: 'https://example.com/private.jpg' }] }])), /이미지/);
  assert.throws(() => bank.save(input('exam.pdf', [{ ...question, questionCaptures: [{ page: 1, box: [0.8, 0, 0.4, 1], image }] }])), /범위/);
  bank.save(input());
  const id = bank.list()[0].id;
  assert.throws(() => bank.select(['../../settings.json']), /중복 없이/);
  assert.throws(() => bank.select([id, id]), /중복 없이/);
});

test('bold and underline persist through disk restart and review serialization', (t) => {
  const root=fixture(t),text='<b>발문 <u>중요한 조건</u></b>\n:::box <보기>\nㄱ. <u>조건</u>을 확인한다.\n:::';
  const bank=createQuestionBank(root);
  bank.save(input('format.pdf',[{...question,text}]));
  const reopened=createQuestionBank(root),restored=reopened.select(reopened.list().map(item=>item.id));
  assert.equal(restored[0].text,text);
  const {serializeReview}=require('../lib/review-file.ts');
  assert.equal(JSON.parse(serializeReview('format.pdf',restored,[])).questions[0].text,text);
});

test('visual choice crops and manual-edit flags survive disk restart and review whitelisting', (t)=>{
  const root=fixture(t),bank=createQuestionBank(root);
  const visualChoices=[{label:'①',page:1,box:[.1,.2,.3,.1],image,apiKey:'must-not-save'}];
  bank.save(input('visual.pdf',[{...question,visualChoices,textEdited:true,analysisWarning:'원본 그림 확인'}]));
  const reopened=createQuestionBank(root),restored=reopened.select(reopened.list().map(i=>i.id))[0];
  assert.deepEqual(restored.visualChoices,[{label:'①',page:1,box:[.1,.2,.3,.1],image}]);
  assert.equal(restored.textEdited,true);assert.equal(restored.analysisWarning,'원본 그림 확인');
  const {serializeReview}=require('../lib/review-file.ts');
  const encoded=serializeReview('visual.pdf',[restored],[image]);
  assert.ok(!encoded.includes('must-not-save'));
  assert.deepEqual(JSON.parse(encoded).questions[0].visualChoices,[{label:'①',page:1,box:[.1,.2,.3,.1]}]);
  assert.throws(()=>bank.save(input('bad.pdf',[{...question,visualChoices:[{...visualChoices[0],image:'https://example.com/x.jpg'}]}])),/이미지/);
  assert.throws(()=>bank.save(input('bad.pdf',[{...question,visualChoices:[{...visualChoices[0],box:[.9,0,.4,.1]}]}])),/범위/);
});

test('failed atomic replacement keeps the previous saved version and its index together', (t) => {
  const root = fixture(t);
  const bank = createQuestionBank(root);
  bank.save(input());
  const id = bank.list()[0].id;
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('disk write failed'); };
  try { assert.throws(() => bank.save(input('exam.pdf', [{ ...question, text: 'must-not-publish' }])), /disk write failed/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(bank.list()[0].text, '원문');
  assert.equal(bank.select([id])[0].text, '원문');
  assert.equal(fs.readdirSync(root).length, 1);
});

test('browser save sends whitelisted snapshots and a stable fingerprint, never full pages or keys', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  const bodies = [];
  global.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return Response.json({ saved: 1, updated: false }); };
  await saveToQuestionBank('exam.pdf', [{ ...question, text: '\text{일반 문장}' }], ['confidential full page']);
  await saveToQuestionBank('exam.pdf', [question], ['confidential full page']);
  assert.equal(bodies[0].sourceFingerprint, bodies[1].sourceFingerprint);
  assert.equal(bodies[0].questions[0].text, '일반 문장');
  assert.doesNotMatch(JSON.stringify(bodies), /apiKey|must-not-save|confidential full page/);
});

test('existing bank entries are normalized for display and export without rewriting disk or calling AI', async (t) => {
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  const raw = { ...question, text: String.raw`\bullet 이전 저장 문항` };
  global.fetch = async (url) => {
    assert.ok(url.startsWith('/api/question-bank'));
    return Response.json(url.endsWith('/selection') ? { questions: [raw] } : { items: [{ id: 'test', text: raw.text }] });
  };
  assert.equal((await listBankItems())[0].text, '• 이전 저장 문항');
  assert.equal((await loadBankSelection(['test']))[0].text, '• 이전 저장 문항');
  assert.equal(raw.text, String.raw`\bullet 이전 저장 문항`);
});
