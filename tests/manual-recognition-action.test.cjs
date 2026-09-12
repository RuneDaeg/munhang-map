/* oxlint-disable typescript/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production handler without mounting React or making API calls.
// This is trusted checkout code, not a sandbox for untrusted source. AST guards
// make a moved/renamed/duplicated handler fail instead of silently testing a copy.
const filename = path.join(__dirname, '../app/page.tsx');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const homes = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Home');
assert.equal(homes.length, 1, 'Expected exactly one top-level Home function');
assert.ok(homes[0].body, 'Home must have a body');
const handlers = homes[0].body.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'recognizeSelectedQuestion');
assert.equal(handlers.length, 1, 'Expected exactly one direct Home recognition handler');
assert.equal(handlers[0].parameters.length, 0, 'Review this harness if the handler gains parameters');
assert.ok(handlers[0].modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
const compiled = ts.transpileModule(handlers[0].getText(source), {
  fileName: 'manual-recognition-action.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
});
assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const handlerScript = new vm.Script(compiled.outputText, { filename: filename + '#recognizeSelectedQuestion' });

function setup() {
  const question = { number: 13, text: 'original question', questionCaptures: [{ image: 'selected capture' }] };
  const other = { number: 18, text: 'other question', questionCaptures: [{ image: 'other capture' }] };
  const calls = { status: 0, confirmation: [], recognition: [], errors: [], events: [] };
  const state = {
    questionData: [question, other], selected: 0, current: [question, other],
    operationRef: { current: false }, recognizingQuestion: null, savingBank: false, status: 'ready',
    standards: [{ code: '[local-catalog]' }],
    getVisionStatus: async () => {
      calls.status++;
      calls.events.push('status');
      return { available: true, local: true, providerLabel: 'Mock Provider' };
    },
    applyVisionStatus: () => {},
    setRecognizingQuestion: value => { state.recognizingQuestion = value; },
    setVisionError: value => { calls.errors.push(value); },
    window: { confirm: message => {
      calls.confirmation.push(message);
      calls.events.push('confirm');
      return true;
    } },
    enhanceQuestionsWithVision: async questions => {
      calls.recognition.push(questions);
      calls.events.push('recognize');
      return { questions: [{ ...questions[0], text: 'recognized question' }], warnings: [], failures: [] };
    },
    loadAchievementStandards: async () => { throw new Error('The preloaded local catalog should be used'); },
    setStandards: () => {},
    classifyQuestion: question => question,
    setQuestionData: update => { state.current = update(state.current); },
  };
  // No fetch, require, process, or desktop bridge is exposed. All dependencies
  // used by this handler are explicit mocks; dynamic code generation is disabled.
  const context = vm.createContext(state, { codeGeneration: { strings: false, wasm: false } });
  handlerScript.runInContext(context, { timeout: 1000 });
  const run = () => vm.runInContext('recognizeSelectedQuestion()', context, { timeout: 1000 });
  return { state, calls, question, other, run };
}

function assertReleased(state) {
  assert.equal(state.operationRef.current, false);
  assert.equal(state.recognizingQuestion, null);
}

test('cancelled question/provider/cost confirmation never starts recognition and releases the action', async () => {
  const { state, calls, question, run } = setup();
  state.window.confirm = message => { calls.confirmation.push(message); return false; };
  await run();
  assert.equal(calls.status, 1);
  assert.equal(calls.confirmation.length, 1);
  assert.equal(calls.recognition.length, 0);
  assert.equal(state.current[0], question);
  assertReleased(state);
});

test('confirmed API action submits exactly the selected question after naming its provider and costs', async () => {
  const { state, calls, question, other, run } = setup();
  await run();
  assert.deepEqual(calls.events.slice(0, 3), ['status', 'confirm', 'recognize']);
  assert.equal(calls.recognition.length, 1);
  assert.equal(calls.recognition[0].length, 1);
  assert.equal(calls.recognition[0][0], question);
  assert.match(calls.confirmation[0], /13번.*Mock Provider/);
  assert.match(calls.confirmation[0], /캡처 이미지.*추출문/);
  assert.match(calls.confirmation[0], /공통 지문/);
  assert.match(calls.confirmation[0], /요금/);
  assert.match(calls.confirmation[0], /외부 반출 금지 자료라면 취소/);
  assert.match(calls.confirmation[0], /API 키를 로컬에 저장해도 판독 자료는/);
  assert.equal(state.current[0].text, 'recognized question');
  assert.equal(state.current[0].textEdited, false);
  assert.equal(state.current[1], other);
  assertReleased(state);
});

const blockedStates = [
  ['missing question captures, even when a whole source page exists', state => {
    state.questionData[0] = { ...state.questionData[0], questionCaptures: [], sourcePageImage: 'whole page must not be sent' };
  }],
  ['an already acquired operation lock', state => { state.operationRef.current = true; }],
  ['ongoing local PDF analysis', state => { state.status = 'analyzing'; }],
  ['an ongoing question-bank save', state => { state.savingBank = true; }],
  ['another question recognition already in progress', state => { state.recognizingQuestion = 18; }],
];
for (const [label, configure] of blockedStates) {
  test('recognition refuses ' + label + ' before status lookup or confirmation', async () => {
    const { state, calls, run } = setup();
    configure(state);
    await run();
    assert.equal(calls.status, 0);
    assert.equal(calls.confirmation.length, 0);
    assert.equal(calls.recognition.length, 0);
  });
}

test('an unavailable API connection gives local-use guidance without submitting a request', async () => {
  const { state, calls, question, run } = setup();
  state.getVisionStatus = async () => { calls.status++; return { available: false, local: true }; };
  await run();
  assert.equal(calls.status, 1);
  assert.equal(calls.confirmation.length, 0);
  assert.equal(calls.recognition.length, 0);
  assert.match(calls.errors.at(-1), /먼저 API 연결/);
  assert.match(calls.errors.at(-1), /API 없이/);
  assert.equal(state.current[0], question);
  assertReleased(state);
});

test('edited questions warn before submission, duplicate clicks are ignored, and mid-flight edits survive', async () => {
  const { state, calls, question, other, run } = setup();
  question.textEdited = true;
  let finishRecognition;
  state.enhanceQuestionsWithVision = questions => {
    calls.recognition.push(questions);
    return new Promise(resolve => { finishRecognition = resolve; });
  };
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(calls.confirmation[0], /직접 편집한 내용/);
  assert.match(calls.confirmation[0], /검토 파일 저장/);
  await run();
  assert.equal(calls.confirmation.length, 1);
  assert.equal(calls.recognition.length, 1);
  const edited = { ...question, text: 'teacher edit while API is pending', textEdited: true };
  state.current = [edited, other];
  finishRecognition({ questions: [{ ...question, text: 'late API result' }], warnings: [], failures: [] });
  await pending;
  assert.equal(state.current[0], edited);
  assert.equal(state.current[1], other);
  assertReleased(state);
});

test('changing the inspected question during recognition cannot redirect the completed result', async () => {
  const { state, calls, question, other, run } = setup();
  let finishRecognition;
  state.enhanceQuestionsWithVision = questions => {
    calls.recognition.push(questions);
    return new Promise(resolve => { finishRecognition = resolve; });
  };
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  state.selected = 1;
  finishRecognition({ questions: [{ ...question, text: 'result for originally selected question' }], warnings: [], failures: [] });
  await pending;
  assert.equal(calls.recognition.length, 1);
  assert.equal(calls.recognition[0][0], question);
  assert.equal(state.current[0].text, 'result for originally selected question');
  assert.equal(state.current[1], other);
  assertReleased(state);
});
