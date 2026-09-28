/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readQuestionContext, questionLabel } = require('../lib/question-context.ts');
const { serializeReview, parseReview } = require('../lib/review-file.ts');
const { createQuestionBank } = require('../local/question-bank.cjs');
const { createDocxBytes, createHwpxBytes, createStandardArchive } = require('../lib/document-export.ts');
const image = 'data:image/jpeg;base64,/9j/2Q==';
const sample = { number: 31, sourceQuestionNumber: 23, sectionLabel: '미적분', type: '자동 추출 문항', text: '$x^{2}$ 의 값은?', standardCode: '[test]', standard: '기준', domain: '수학', confidence: 80, questionCaptures: [{ page: 1, box: [0, 0, 1, 1], image }] };
function unzip(bytes) {
  const b = Buffer.from(bytes), files = new Map();
  for(let o = 0; b.readUInt32LE(o) === 0x04034b50;) {
    const size = b.readUInt32LE(o+18), names = b.readUInt16LE(o+26), extra = b.readUInt16LE(o+28), start = o+30+names+extra;
    files.set(b.toString('utf8',o+30,o+30+names), b.subarray(start,start+size)); o=start+size;
  }
  return files;
}
test('elective metadata is whitelisted, bounded, and does not alter internal ids', () => {
  assert.equal(questionLabel(sample), '미적분 · 23번');
  assert.equal(questionLabel({number: 31}), '31번');
  assert.deepEqual(readQuestionContext({ sourceQuestionNumber: -1, sectionLabel: ' ', apiKey: 'private' }), {});
  assert.deepEqual(readQuestionContext({...sample, sectionLabel: ' 미적분\n ', apiKey: 'private'}), {sourceQuestionNumber: 23, sectionLabel: '미적분'});
});
test('repeated original numbers survive bank restart, selection, edit, and review round trip', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'munhang-sections-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let bank=createQuestionBank(root);
  bank.save({sourceFileName:'exam.pdf',sourceFingerprint:'a'.repeat(64),questions:[sample,{...sample,number:39,sectionLabel:'기하'}]});
  bank=createQuestionBank(root);
  const items=bank.list();
  assert.equal(items.length,2);
  assert.deepEqual(new Set(items.map(q=>q.sectionLabel)),new Set(['미적분','기하']));
  const entry=bank.inspect(items.find(q=>q.sectionLabel==='미적분').id);
  const updated=bank.update({id:entry.id,revision:entry.revision,text:'$x^{3}$ 의 값은?'});
  assert.equal(updated.question.sourceQuestionNumber,23);
  assert.equal(updated.question.sectionLabel,'미적분');
  const oldImage=global.Image,oldDocument=global.document;
  t.after(()=>{global.Image=oldImage;global.document=oldDocument;});
  global.Image=class {naturalWidth=100;naturalHeight=100;set src(value){queueMicrotask(()=>this.onload());}};
  global.document={createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>image})};
  const review=await parseReview(serializeReview('exam.pdf',bank.select(items.map(q=>q.id)),[image]));
  assert.deepEqual(review.questions.map(q=>[q.number,q.sourceQuestionNumber,q.sectionLabel]),items.map(q=>[q.number,23,q.sectionLabel]));
});
test('DOCX, HWPX and mapping CSV display original elective question identity', async t => {
  const oldFetch=global.fetch;t.after(()=>global.fetch=oldFetch);
  global.fetch=async url=>new Response(fs.readFileSync(path.join(__dirname,'../public',url)));
  const docx=unzip(createDocxBytes('시험',[sample]));
  assert.match(docx.get('word/document.xml').toString(),/미적분 · 23번 문항/);
  assert.doesNotMatch(docx.get('word/document.xml').toString(),/31번 문항/);
  const hwpx=unzip(await createHwpxBytes('시험',[sample]));
  assert.match(hwpx.get('Contents/section0.xml').toString(),/미적분 · 23번 문항/);
  const archive=unzip(await createStandardArchive('시험',[sample],'docx'));
  assert.match(archive.get('문항목록.csv').toString(),/미적분 · 23번/);
});
