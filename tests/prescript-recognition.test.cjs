/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { hasMissingSourcePrescripts, mathQualityIssues } = require('../lib/math-quality.ts');
const { normalizeQuestionText, mathForRendering, splitMathText } = require('../lib/math-normalization.ts');
const { preserveQuestionParts } = require('../lib/question-completeness.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const { latexToOmml } = require('../lib/docx-math.ts');
const { latexToHwpScript } = require('../lib/hwpx-math.ts');
const { recognize } = require('../desktop/provider-client.cjs');
const MathText = require('../components/math-text.tsx').default;

const isotope = String.raw`{}^{2}_{1}\mathrm{H}`;
const source = '다음은 원자핵 표기 자료이다 .\n$' + isotope + '$의 왼쪽 위 숫자와 아래 숫자를 구별할 수 있는가?';
const image = 'data:image/jpeg;base64,/9j/2Q==';

test('source isotope roles survive equivalent script order, font wrappers and JSON round trips', () => {
  for (const latex of [isotope, String.raw`{}_{1}^{2}H`, String.raw`{}^2_1{\mathrm{H}}`, String.raw`{}_{1}^{2}\text{H}`]) {
    assert.equal(hasMissingSourcePrescripts('$' + latex + '$', source), false, latex);
  }
  assert.equal(hasMissingSourcePrescripts(String.raw`$ {}^3_2\text{He} $`, String.raw`$ {}^{3}_{2}\mathrm{He} $`), false);
  assert.equal(hasMissingSourcePrescripts(String.raw`$ {}^0_{-1}e $`, String.raw`$ {}^{0}_{−1}\mathrm{e} $`), false);
  assert.equal(hasMissingSourcePrescripts(String.raw`$ {}^{35}\mathrm{Cl}_{2} $`, String.raw`$ {}^{35}\mathrm{Cl_2} $`), false);
  assert.equal(hasMissingSourcePrescripts(String.raw`$ {}^{35}\mathrm{C} $`, String.raw`$ {}^{35}\mathrm{Cl_2} $`), true, 'a molecule subscript cannot truncate Cl to C');
  assert.equal(normalizeQuestionText(source), source);
  assert.equal(normalizeQuestionText(normalizeQuestionText(source)), source);
  assert.equal(JSON.parse(JSON.stringify(source)), source);
  assert.equal(mathForRendering(isotope), isotope);
  assert.deepEqual(mathQualityIssues(source), []);
});

test('valid but degraded isotope transcriptions are caught without inferring missing values', () => {
  for (const latex of [String.raw`21\mathrm{H}`, String.raw`2\mathrm{H}`, String.raw`\mathrm{H}^{2}_{1}`, String.raw`{}^{1}_{2}\mathrm{H}`, String.raw`{}^{3}_{1}\mathrm{H}`, String.raw`{}^{2}\mathrm{H}`, String.raw`{}^{2}_{1}\mathrm{He}`]) {
    const candidate = source.replace(isotope, latex);
    assert.deepEqual(mathQualityIssues(candidate), [], 'syntax alone cannot detect this loss');
    assert.equal(hasMissingSourcePrescripts(candidate, source), true, latex);
    const preserved = preserveQuestionParts(candidate, source, []);
    assert.equal(preserved.keptOriginal, true);
    assert.equal(preserved.text, source);
    assert.match(preserved.warning, /왼쪽 위·아래 첨자/);
  }
  assert.equal(hasMissingSourcePrescripts('$' + isotope + '$', '$' + isotope + '+' + isotope + '$'), true, 'every repeated source atom needs its own occurrence');
  assert.equal(hasMissingSourcePrescripts('$' + isotope + '$', String.raw`$ {}^{2}H $`), false, 'image recognition may add an index absent from source text');
  assert.equal(hasMissingSourcePrescripts('$' + isotope + '$', '원문에서 읽히지 않은 숫자와 H'), false, 'do not invent a source isotope');
});

test('spaced sentence punctuation and harmless math restyling cannot prepend the whole original stem', () => {
  const flat = '다음은 원자핵 표기 자료이다 .\n2 H\n1\n이에 대한 설명으로 옳은 것은 ?';
  const corrected = '다음은 원자핵 표기 자료이다.\n$' + isotope + '$\n이에 대한 설명으로 옳은 것은?';
  const completed = preserveQuestionParts(corrected, flat, []);
  assert.equal(completed.text, corrected);
  assert.equal(completed.keptOriginal, false);
  assert.equal(completed.text.match(/다음은/g).length, 1);
  const first = String.raw`다음 원자핵 $ {}^2_1H $의 표기로 옳은 것은?`;
  const restyled = String.raw`다음 원자핵 $ {}_{1}^{2}\mathrm{H} $의 표기로 옳은 것은?`;
  assert.equal(preserveQuestionParts(restyled, first, []).text, restyled);
  assert.equal(preserveQuestionParts('자료만 있습니다.', '다음 자료의 제목으로 가장 적절한 것은?\n자료만 있습니다.', []).text, '다음 자료의 제목으로 가장 적절한 것은?\n자료만 있습니다.');
});

test('mock API degradation preserves source and disables the success badge', async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const question = { number: 6, text: source, assessmentText: source, sourcePageImage: image };
  for (const degraded of [source.replace(isotope, String.raw`21\mathrm{H}`), source.replace(isotope, String.raw`\mathrm{H}^{2}_{1}`)]) {
    global.fetch = async () => Response.json({ questions: [{ number: 6, latexText: degraded, directStem: degraded }] });
    const result = await enhanceQuestionsWithVision([question]);
    assert.equal(result.questions[0].text, source);
    assert.equal(result.questions[0].assessmentText, source);
    assert.equal(result.questions[0].visionEnhanced, false);
    assert.equal(result.questions[0].text.match(/다음은/g).length, 1);
    assert.match(result.warnings.join(' '), /왼쪽 위·아래 첨자/);
    assert.deepEqual(result.failures, []);
  }
  global.fetch = async () => Response.json({ questions: [{ number: 6, latexText: source.replace(isotope, String.raw`{}_{1}^{2}H`) }] });
  const corrected = await enhanceQuestionsWithVision([question]);
  assert.equal(corrected.questions[0].visionEnhanced, true);
  assert.deepEqual(corrected.warnings, []);
});

test('structured blocks and shared assessment cannot silently lose full-text prescripts', async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const degraded = source.replace(isotope, String.raw`21\mathrm{H}`);
  global.fetch = async () => Response.json({ questions: [{ number: 6, latexText: source, blocks: [{ kind: 'text', title: '', text: degraded, rows: [], header: false }] }] });
  const result = await enhanceQuestionsWithVision([{ number: 6, text: source, sourcePageImage: image }]);
  assert.equal(result.questions[0].text, source);
  assert.match(result.warnings.join(' '), /구조가 불완전/);
  global.fetch = async () => Response.json({ questions: [{ number: 6, latexText: source, directStem: degraded }] });
  const shared = await enhanceQuestionsWithVision([{ number: 6, text: source, assessmentText: source, sourcePageImage: image, sharedPassage: { text: '공통 자료', pages: [1], range: [5, 6] } }]);
  assert.equal(shared.questions[0].assessmentText, source);
  assert.equal(shared.questions[0].visionEnhanced, false);
  assert.match(shared.warnings.join(' '), /개별 발문.*왼쪽 위·아래 첨자/);
});

test('rendering and native exports keep the empty base and the left-side roles', () => {
  const [math] = splitMathText('$' + isotope + '$');
  const html = renderToStaticMarkup(React.createElement(MathText, { text: '$' + isotope + '$' }));
  assert.match(html, /class="katex"/);
  assert.match(html, /class="mord"><span class="mord"><\/span><span class="msupsub"/);
  assert.ok(html.indexOf('class="msupsub"') < html.indexOf('class="mord mathrm">H'), 'indices precede the element');
  const mathml = require('katex').renderToString(math.text, { output: 'mathml' });
  assert.match(mathml, /<msubsup><mrow><\/mrow><mn>1<\/mn><mn>2<\/mn><\/msubsup>/);
  assert.doesNotMatch(html, /katex-error/);
  assert.match(latexToOmml(math.text), /<m:sPre><m:sub>[\s\S]*?<m:t[^>]*>1<\/m:t>[\s\S]*?<\/m:sub><m:sup>[\s\S]*?<m:t[^>]*>2<\/m:t>[\s\S]*?<\/m:sup>/);
  assert.match(latexToHwpScript(math.text), /LSUB \{1\} LSUP \{2\}/);
});

function assertNuclearPrompt(prompt) {
  assert.match(prompt, /원문 이미지의 실제 배치를 우선/);
  assert.match(prompt, /왼쪽 위의 질량수와 왼쪽 아래의 양성자 수/);
  assert.match(prompt, /빈 그룹 \{\}.*삭제하지 마세요/);
  assert.match(prompt, /보존 법칙으로 추측하여 채우지 마세요/);
  const example = prompt.match(/왼쪽 첨자를 보존한 올바른 JSON 예: (\{[^\n]+\})/)[1];
  assert.equal(JSON.parse(example).latexText, '원자핵 $' + isotope + '$');
}

test('all desktop providers receive an image-first prompt with a parseable escaped isotope example', async (t) => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  for (const provider of ['openai', 'anthropic', 'gemini', 'compatible']) {
    let prompt;
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body), text = JSON.stringify({ questions: [] });
      prompt = provider === 'openai' ? body.input[0].content[0].text : provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[0].content.find((part) => part.type === 'text').text;
      return Response.json(provider === 'openai' ? { output: [{ content: [{ type: 'output_text', text }] }] } : provider === 'anthropic' ? { content: [{ type: 'text', text }] } : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text }] } }] } : { choices: [{ message: { content: text } }] });
    };
    await recognize({ provider, model: 'mock-test', apiKey: 'synthetic-test-only', baseUrl: 'http://127.0.0.1:11434/v1' }, { image, questions: [{ number: 6, text: source }] });
    assertNuclearPrompt(prompt);
  }
});

test('web route uses the same isotope instruction without accessing a real key or network', async () => {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/recognize/route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let prompt;
  const context = { exports: {}, Response, process: { env: { OPENAI_API_KEY: 'synthetic-test-only' } }, fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    prompt = body.input[0].content[0].text;
    return Response.json({ output: [{ content: [{ type: 'output_text', text: '{"questions":[]}' }] }] });
  } };
  vm.runInNewContext(code, context);
  const response = await context.exports.POST(new Request('http://localhost/api/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, questions: [{ number: 6, text: source }] }) }));
  assert.equal(response.status, 200);
  assertNuclearPrompt(prompt);
});
