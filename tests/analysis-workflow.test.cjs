/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { runExamAnalysis } = require('../lib/analysis-workflow.ts');
const { classifyQuestion } = require('../lib/pdf-analysis.ts');

const catalog = [
  { school: '고등학교', subject: '통합과학1', grade: '고1', code: '[measure]', statement: '질량과 길이의 측정값을 비교한다.' },
  { school: '고등학교', subject: '통합과학1', grade: '고1', code: '[earth]', statement: '지구의 판 경계와 화산 활동을 설명한다.' },
];
const original = {
  number: 1, type: '자동 추출 문항 · 1쪽', text: '질량과 길이의 측정값을 비교한다.',
  standardCode: '', standard: '', confidence: 0, domain: '',
  questionCaptures: [{ page: 1, box: [0, 0, 1, 1], image: 'original capture' }],
};
const pdfResult = (questions = [original], qualityWarning = '') => ({ questions, sourcePages: ['original page'], pageCount: 1, qualityWarning });
const makeDeps = (overrides = {}) => ({
  analyzePdf: async (_file, page, capture) => {
    page(1, 1); capture(0, 1); capture(1, 1);
    return pdfResult();
  },
  loadAchievementStandards: async () => catalog,
  classifyQuestion,
  ...overrides,
});

for (const apiState of ['configured', 'unavailable', 'throwing']) {
  test('PDF upload completes local classification without consulting the ' + apiState + ' API', async (t) => {
    // Legacy dependencies and the network are tripwires, not replacement OCR.
    // A configured saved connection must not opt an upload into a paid reread.
    const getVisionStatus = t.mock.fn(async () => {
      if (apiState === 'throwing') throw new Error('connection check failed');
      return { available: apiState === 'configured', model: 'saved-model', keyHint: 'saved-key' };
    });
    const enhanceQuestionsWithVision = t.mock.fn(async () => { throw new Error('must not call AI'); });
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network request'); });
    const states = [];
    const result = await runExamAnalysis({}, state => states.push(state), makeDeps({ getVisionStatus, enhanceQuestionsWithVision }));

    assert.equal(getVisionStatus.mock.callCount(), 0);
    assert.equal(enhanceQuestionsWithVision.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(result.questions[0].text, original.text);
    assert.equal(result.questions[0].standardCode, '[measure]');
    assert.equal(result.questions[0].standard, catalog[0].statement);
    assert.ok(result.questions[0].standardCandidates.length > 0);
    assert.deepEqual(result.questions[0].validationFlags, []);
    assert.deepEqual(result.questions[0].questionCaptures, original.questionCaptures);
    assert.deepEqual(result.sourcePages, ['original page']);
    assert.equal(result.catalog, catalog);
    assert.equal(result.qualityWarning, '');
    assert.equal(Object.hasOwn(result, 'vision'), false);
    assert.equal(Object.hasOwn(result, 'failures'), false);
    assert.equal(result.questions[0].visionEnhanced, undefined);
    assert.deepEqual([...new Set(states.map(state => state.stage))], ['pdf', 'capture', 'classify']);
    assert.equal(states.at(-1).percent, 100);
    assert.equal(states.at(-1).detail, '분석 처리 완료');
    assert.ok(states.every((state, index) => Number.isFinite(state.percent) && state.percent >= 0 && state.percent <= 100 && (!index || state.percent >= states[index - 1].percent)));
    assert.equal(original.standardCode, '');
    assert.equal(original.validationFlags, undefined);
  });
}

test('results settle only after local capture, catalog loading and classification finish', async () => {
  let finishCapture, finishCatalog;
  let settled = false;
  const states = [], classified = [];
  const second = { ...original, number: 2, text: '지구의 판 경계와 화산 활동을 설명한다.' };
  const task = runExamAnalysis({}, state => states.push(state), makeDeps({
    analyzePdf: async (_file, page, capture) => {
      page(1, 2); page(2, 2); capture(0, 2); capture(1, 2);
      await new Promise(resolve => { finishCapture = resolve; });
      capture(2, 2);
      return { ...pdfResult([original, second]), pageCount: 2 };
    },
    loadAchievementStandards: () => new Promise(resolve => { finishCatalog = resolve; }),
    classifyQuestion: (question, loadedCatalog) => {
      classified.push(question.number);
      assert.equal(loadedCatalog, catalog);
      return classifyQuestion(question, loadedCatalog);
    },
  })).then(result => { settled = true; return result; });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(states.at(-1).stage, 'capture');
  assert.equal(states.at(-1).completed, 1);
  assert.deepEqual(classified, []);
  finishCapture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(states.at(-1).stage, 'classify');
  assert.equal(states.at(-1).percent, 95);
  assert.deepEqual(classified, []);
  finishCatalog(catalog);
  const result = await task;
  assert.deepEqual(classified, [1, 2]);
  assert.deepEqual(result.questions.map(q => q.standardCode), ['[measure]', '[earth]']);
  assert.equal(states.at(-1).percent, 100);
  assert.ok(states.every((state, index) => !index || state.percent >= states[index - 1].percent));
});

test('failed PDF, empty extraction and missing local catalog reject without claiming completion', async () => {
  for (const [overrides, message] of [
    [{ analyzePdf: async () => { throw new Error('broken PDF'); } }, /broken PDF/],
    [{ analyzePdf: async () => pdfResult([]) }, /문항을 찾지 못했습니다/],
    [{ loadAchievementStandards: async () => { throw new Error('local catalog unavailable'); } }, /local catalog unavailable/],
  ]) {
    const states = [];
    await assert.rejects(runExamAnalysis({}, state => states.push(state), makeDeps(overrides)), message);
    assert.ok(states.every(state => state.percent < 100));
    assert.ok(states.every(state => state.stage !== 'vision'));
  }
});

test('unresolved source glyphs, source warnings and code-based review flags survive local analysis', async () => {
  const broken = {
    ...original,
    text: '거리 \uE00B, 측정값 \uE039\uE038\uE053\uE03D cm',
    analysisWarning: '분수·루트의 일부 배치를 확정하지 못했습니다.',
    captureWarning: '문항 경계를 원문과 대조해 주세요.',
  };
  const sourceWarning = 'PDF 기본 추출에서 5개 문자를 복원하지 못했습니다.';
  const states = [];
  const result = await runExamAnalysis({}, state => states.push(state), makeDeps({
    analyzePdf: async () => pdfResult([broken], sourceWarning),
  }));
  assert.equal(result.questions[0].text, broken.text);
  assert.deepEqual(result.questions[0].questionCaptures, broken.questionCaptures);
  assert.equal(result.questions[0].analysisWarning, broken.analysisWarning);
  assert.equal(result.questions[0].captureWarning, broken.captureWarning);
  assert.ok(result.qualityWarning.includes(sourceWarning));
  assert.match(result.qualityWarning, /1개 문항\(1번\).*복원하지 못/);
  assert.match(result.qualityWarning, /1개 문항\(1번\).*원본 대조/);
  assert.match(result.qualityWarning, /1개 문항에 자동 검토 항목/);
  const flags = result.questions[0].validationFlags.map(flag => flag.code);
  for (const code of ['pua_present', 'source_layout_review', 'capture_review']) assert.ok(flags.includes(code), code);
  assert.equal(states.at(-1).detail, '일부 추출 결과 확인 필요');
});

test('catalog membership is validated after classification without any AI judgment', async () => {
  const result = await runExamAnalysis({}, () => {}, makeDeps({
    classifyQuestion: (question, loadedCatalog) => ({ ...classifyQuestion(question, loadedCatalog), standardCode: '[not-in-catalog]' }),
  }));
  assert.ok(result.questions[0].validationFlags.some(flag => flag.code === 'code_not_in_catalog'));
  assert.match(result.qualityWarning, /자동 검토 항목/);
});
