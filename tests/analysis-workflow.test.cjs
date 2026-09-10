/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { runExamAnalysis } = require('../lib/analysis-workflow.ts');

const original = { number: 1, text: '기본 추출문', questionCaptures: [{ image: 'original capture' }] };
const makeDeps = (overrides = {}) => ({
  analyzePdf: async (_file, page, capture) => { page(1, 1); capture(0, 1); capture(1, 1); return { questions: [original], sourcePages: ['page'], pageCount: 1, qualityWarning: '' }; },
  getVisionStatus: async () => ({ available: true }),
  loadAchievementStandards: async () => [],
  classifyQuestion: (question) => ({ ...question, standardCode: '[test]' }),
  enhanceQuestionsWithVision: async (questions, progress) => { progress(1, 1); return { questions, failures: [] }; },
  ...overrides,
});

test('analysis does not publish text-only results while vision is still pending', async () => {
  let finishVision;
  let settled = false;
  const states = [];
  const task = runExamAnalysis({}, (state) => states.push(state), makeDeps({ enhanceQuestionsWithVision: () => new Promise((resolve) => { finishVision = resolve; }) })).then((result) => { settled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(states.at(-1).stage, 'vision');
  assert.match(states.at(-1).detail, /1번.*0\/1/);
  finishVision({ questions: [{ ...original, text: '발문과 수식 판독 완료' }], failures: [] });
  const result = await task;
  assert.equal(result.questions[0].text, '발문과 수식 판독 완료');
  assert.equal(result.questions[0].standardCode, '[test]');
  assert.deepEqual(result.questions[0].questionCaptures, original.questionCaptures);
  assert.equal(states.at(-1).percent, 100);
  assert.ok(states.every((state, index) => !index || state.percent >= states[index - 1].percent));
});

test('missing API is explicitly reported as skipped, while individual failures keep captures', async () => {
  const offline = await runExamAnalysis({}, () => {}, makeDeps({ getVisionStatus: async () => ({ available: false }), enhanceQuestionsWithVision: () => { throw new Error('must not call API'); } }));
  assert.match(offline.qualityWarning, /건너뛰었습니다/);
  const partial = await runExamAnalysis({}, () => {}, makeDeps({ enhanceQuestionsWithVision: async (questions) => ({ questions, failures: ['timeout'] }) }));
  assert.match(partial.qualityWarning, /1개 문항.*완료하지 못/);
  assert.equal(partial.questions[0].text, original.text);
  assert.deepEqual(partial.questions[0].questionCaptures, original.questionCaptures);
});

test('failed PDF or connection checks fail the workflow instead of claiming completion', async () => {
  await assert.rejects(runExamAnalysis({}, () => {}, makeDeps({ analyzePdf: async () => { throw new Error('broken PDF'); } })), /broken PDF/);
  await assert.rejects(runExamAnalysis({}, () => {}, makeDeps({ getVisionStatus: async () => { throw new Error('connection check failed'); } })), /connection check failed/);
});

test('unresolved final characters need review; a successful OCR repair clears the stale PDF warning', async () => {
  const broken={...original,text:'거리 \uE00B, 측정값 \uE039\uE038\uE053\uE03D cm'};
  const pdf = async()=>({questions:[broken],sourcePages:[],pageCount:1,qualityWarning:'PDF 기본 추출에서 문자를 복원하지 못했습니다.'});
  const states=[];
  const partial=await runExamAnalysis({},state=>states.push(state),makeDeps({analyzePdf:pdf,getVisionStatus:async()=>({available:false})}));
  assert.match(partial.qualityWarning,/1개 문항\(1번\).*복원하지 못/);
  assert.equal(states.at(-1).detail,'일부 판독 결과 확인 필요');
  const repaired=await runExamAnalysis({},()=>{},makeDeps({analyzePdf:pdf,enhanceQuestionsWithVision:async()=>({questions:[{...broken,text:'거리 L, 측정값 65.0 cm'}],failures:[]})}));
  assert.equal(repaired.qualityWarning,'');
});
