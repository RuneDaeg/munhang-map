/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { normalizeQuestionText: normalize, splitMathText } = require('../lib/math-normalization.ts');
const { enhanceQuestionsWithVision } = require('../lib/vision-recognition.ts');
const { serializeReview, parseReview } = require('../lib/review-file.ts');

test('reproduces JSON backslash-t corruption and unwraps both damaged and proper prose', () => {
  const damaged = JSON.parse(String.raw`{"text":"\text{다음은 학생 A, B, C가 거리 } L \text{을 측정하는 탐구 활동이다.}"}`).text;
  assert.ok(damaged.startsWith('\text{'));
  assert.equal(normalize(damaged), '다음은 학생 A, B, C가 거리  L 을 측정하는 탐구 활동이다.');
  assert.equal(normalize(String.raw`\text{[탐구 과정]} (가) ` + '\text{자신의 보폭을 cm 단위의 줄자로 측정한다.}'), '[탐구 과정] (가) 자신의 보폭을 cm 단위의 줄자로 측정한다.');
  assert.equal(normalize('ext{이에 대한 설명으로 옳은 것은?}'), '이에 대한 설명으로 옳은 것은?');
});

test('prose-only math and simple values become ordinary text without modifying real math labels', () => {
  assert.equal(normalize(String.raw`$X\text{에 가장 적절한 것은?}$`), 'X에 가장 적절한 것은?');
  assert.equal(normalize(String.raw`속력은 $60\text{ km/h}$이다. $\text{① 고무}$`), '속력은 60 km/h이다. ① 고무');
  const formula = String.raw`속력은 $v=\frac{\text{거리}}{\text{시간}}$, $F_{\text{합}}=ma$, $\sqrt{x^2+y^2}$이다.`;
  assert.equal(normalize(formula), formula);
  for (const part of splitMathText(formula).filter((part) => part.math)) assert.doesNotThrow(() => katex.renderToString(part.text, { throwOnError: true }));
});

test('balanced text braces preserve inner sets, escaped braces and unfinished user input', () => {
  assert.equal(normalize(String.raw`\text{집합 {A, B}와 \text{학생 C}}`), '집합 {A, B}와 학생 C');
  assert.equal(normalize(String.raw`\text{기호 \{A\}를 보시오}`), String.raw`기호 \{A\}를 보시오`);
  assert.equal(normalize(String.raw`\text{아직 입력 중`), String.raw`\text{아직 입력 중`);
  assert.equal(normalize(String.raw`\text{식 $x_{\text{합}}=1$을 보시오.}`), String.raw`식 $x_{\text{합}}=1$을 보시오.`);
  const ordinary = '항목\t값\nA\t65.0 cm\ncontext{example}\n가격 \\$5, \\$10';
  assert.equal(normalize(ordinary), ordinary);
});

test('alternate delimiters and legacy arrays render while keeping their math structure', () => {
  assert.equal(normalize(String.raw`\(x^2\)와 \[\frac{a}{b}\]`), String.raw`$x^2$와 $$\frac{a}{b}$$`);
  const array = String.raw`\begin{array}{|c|c|}\hline \text{학생 A} & 65.0\,\text{cm} \\ \hline\end{array}`;
  const normalized = normalize(String.raw`\text{[탐구 결과]} ` + array.replace(/\\text/g, '\text'));
  assert.equal(normalized, '[탐구 결과] $$' + array + '$$');
  const parts = splitMathText(normalized);
  assert.equal(parts[1].math, true);
  assert.equal(parts[1].display, true);
  assert.doesNotThrow(() => katex.renderToString(parts[1].text, { throwOnError: true }));
  assert.equal(normalize('$\frac{a}{b}$'), String.raw`$\frac{a}{b}$`);
});

test('normalization is idempotent and JSON round-trips once without damaging formula slashes', () => {
  const samples = [String.raw`\text{설명} $x_{\text{합}}=\frac{1}{2}$`, '$\text{질문}$', '\text{65.0 cm}', '보존\t해야 하는 탭', String.raw`\[x^2\]`];
  for (const sample of samples) {
    const result = normalize(sample);
    assert.equal(normalize(result), result);
    assert.equal(JSON.parse(JSON.stringify({ text: result })).text, result);
  }
});

test('bare bullet and common LaTeX symbols render as prose, without changing explicit math', () => {
  const input = String.raw`다음은 섬 A의 자료이다.\n\bullet A는 동태평양에 있다.
\bullet 작은 부리는 부드러운 씨앗에 유리하다.
\circ 개체수 \rightarrow 증가, 2 \times 3 \leq 6, \alpha \approx 1`;
  assert.equal(normalize(input), '다음은 섬 A의 자료이다.\n• A는 동태평양에 있다.\n• 작은 부리는 부드러운 씨앗에 유리하다.\n○ 개체수 → 증가, 2 × 3 ≤ 6, α ≈ 1');
  const formula = String.raw`$\bullet\; A \rightarrow B$, $2\times3=6$`;
  assert.equal(normalize(formula), formula);
  for (const part of splitMathText(normalize(formula)).filter((part) => part.math)) assert.doesNotThrow(() => katex.renderToString(part.text, { throwOnError: true }));
  assert.equal(normalize('\bullet A'), '• A'); // JSON-decoded backspace + ullet
  assert.equal(normalize(String.raw`\bullet{} A \textbullet B`), '• A • B');
  assert.equal(normalize(String.raw`\bulletin \unknown{data} \\bullet`), String.raw`\bulletin \unknown{data} \\bullet`);
});

test('complete bare formula commands become KaTeX spans and nested text labels are preserved', () => {
  const input = String.raw`속력은 \frac{\text{이동 거리}}{\text{시간}}, 길이는 \sqrt[3]{x}, 벡터는 \vec{v}이다.`;
  const expected = String.raw`속력은 $\frac{\text{이동 거리}}{\text{시간}}$, 길이는 $\sqrt[3]{x}$, 벡터는 $\vec{v}$이다.`;
  assert.equal(normalize(input), expected);
  assert.equal(normalize(expected), expected);
  for (const part of splitMathText(expected).filter((part) => part.math)) assert.doesNotThrow(() => katex.renderToString(part.text, { throwOnError: true }));
  assert.equal(normalize(String.raw`아직 \frac{a}{ 입력 중 \sqrt[`), String.raw`아직 \frac{a}{ 입력 중 \sqrt[`);
  assert.equal(normalize(String.raw`\text{값은 \frac{1}{2}이다.}`), String.raw`값은 $\frac{1}{2}$이다.`);
});

test('API results are cleaned before classification, with captures and completeness fallback preserved', async (t) => {
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  const capture = { page: 1, box: [0, 0, 0.5, 0.5], image: 'data:image/jpeg;base64,/9j/2Q==' };
  const question = { number: 1, text: '질문', questionCaptures: [capture] };
  global.fetch = async () => Response.json({ questions: [{ number: 1, indirectStem: '\text{그림은 반도체를 나타낸 것이다.}', directStem: String.raw`$X\text{로 적절한 것은?}$`, choices: [String.raw`\text{① 고무}`, String.raw`\text{② 규소}`], latexText: '짧은 결과' }] });
  const result = await enhanceQuestionsWithVision([question]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.questions[0].text, '그림은 반도체를 나타낸 것이다.\nX로 적절한 것은?\n① 고무\n② 규소');
  assert.deepEqual(result.questions[0].questionCaptures, [capture]);
  const longText = String.raw`\text{그림은 위와 아래의 긴 발문을 모두 포함한다. 이 문항의 내용을 생략하지 않고 보존해야 한다. 자료를 읽고 물음에 답하시오. 모든 선택지를 검토하시오.}`;
  const fallback = await enhanceQuestionsWithVision([{ ...question, text: longText }]);
  assert.equal(fallback.questions[0].text, normalize(longText));
});

test('saved reviews contain cleaned prose and round-trippable formulae, without mutating the question', () => {
  const question = { number: 1, text: String.raw`\text{식은 }$\frac{a}{b}$` };
  const stored = JSON.parse(serializeReview('exam.pdf', [question], []));
  assert.equal(stored.questions[0].text, String.raw`식은 $\frac{a}{b}$`);
  assert.equal(question.text, String.raw`\text{식은 }$\frac{a}{b}$`);
});

test('legacy review import cleans stored text and leaves confirmed capture coordinates intact', async (t) => {
  const { createRequire } = require('node:module');
  const canvas = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas');
  const previous = { Image: global.Image, document: global.document };
  t.after(() => { global.Image = previous.Image; global.document = previous.document; });
  global.Image = canvas.Image;
  global.document = { createElement: () => canvas.createCanvas(1, 1) };
  const image = canvas.createCanvas(100, 100).toDataURL('image/jpeg');
  const box = [0.1, 0.2, 0.4, 0.3];
  const review = { format: 'munhang-map-review', version: 1, fileName: 'exam.pdf', sourcePages: [image], questions: [{ number: 1, type: 'test', text: '\text{다음은 탐구 활동이다.}\n' + String.raw`\text{① 선택지}`, standardCode: '', standard: '', domain: '', confidence: 35, captureReviewed: true, sourcePage: 1, regions: [{ page: 1, box }] }] };
  const restored = await parseReview(JSON.stringify(review));
  assert.equal(restored.questions[0].text, '다음은 탐구 활동이다.\n① 선택지');
  assert.equal(restored.questions[0].captureReviewed, true);
  assert.deepEqual(restored.questions[0].questionCaptures[0].box, box);
});

test('web route uses the same plain-prose and valid JSON formula instructions', async (t) => {
  const { POST } = require('../app/api/recognize/route.ts');
  const previousFetch = global.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  t.after(() => {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  process.env.OPENAI_API_KEY = 'mock-test-key';
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.text.format.schema.properties.questions.items.required.includes('blocks'));
    const prompt = body.input[0].content[0].text;
    assert.match(prompt, /일반 자료표는 LaTeX array 대신/);
    assert.ok(prompt.includes('\n:::box\n자료 문장\n:::\n'));
    assert.match(prompt, /:::table/);
    const structure = prompt.match(/줄바꿈을 포함한 올바른 구조 JSON 예: (\{[^\n]*\})/)[1];
    assert.equal(JSON.parse(structure).latexText, '간접 발문\n:::box\n자료 문장\n:::\n직접 발문');
    const example = prompt.match(/올바른 JSON 예: (\{[^\n]*?\}) 이 예/)[1];
    assert.equal(JSON.parse(example).latexText, String.raw`속력은 60 km/h이다. 식은 $\frac{d}{t}$이다.`);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: '{"questions":[]}' }] }] });
  };
  const response = await POST(new Request('http://localhost/api/recognize', { method: 'POST', body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/2Q==', questions: [{ number: 1, text: '테스트 문항' }] }) }));
  assert.equal(response.status, 200);
});
