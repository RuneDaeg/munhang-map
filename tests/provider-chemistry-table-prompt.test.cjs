/* oxlint-disable typescript/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { recognize } = require('../desktop/provider-client.cjs');

const input = {
  image: 'data:image/jpeg;base64,/9j/2Q==',
  questions: [{ number: 1, text: '합성 자료의 표와 수식을 읽으시오.' }],
};

async function capturePrompt(provider, context) {
  const previousFetch = global.fetch;
  context.after(() => { global.fetch = previousFetch; });
  const responseText = JSON.stringify({ questions: [] });
  let prompt;
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    prompt = provider === 'openai' ? body.input[0].content[0].text
      : provider === 'gemini' ? body.contents[0].parts[0].text
        : body.messages[0].content.find((part) => part.type === 'text').text;
    const payload = provider === 'openai' ? { output: [{ content: [{ type: 'output_text', text: responseText }] }] }
      : provider === 'anthropic' ? { content: [{ type: 'text', text: responseText }] }
        : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: responseText }] } }] }
          : { choices: [{ message: { content: responseText } }] };
    return Response.json(payload);
  };
  await recognize({ provider, model: 'prompt-check', apiKey: 'synthetic-test-only', baseUrl: 'http://127.0.0.1:11434/v1' }, input);
  global.fetch = previousFetch;
  return prompt;
}

test('every provider receives split-cell row fidelity and chemistry typography instructions', async (context) => {
  for (const provider of ['openai', 'anthropic', 'gemini', 'compatible']) {
    const prompt = await capturePrompt(provider, context);
    assert.match(prompt, /부분 가로선[\s\S]*각각 별도 행/);
    assert.match(prompt, /세로로 병합된 부모 제목[\s\S]*각 해당 행에 반복/);
    assert.match(prompt, /반복 허용은 부모 제목뿐/);
    assert.match(prompt, /모든 수치·단위와 열 대응을 그대로 보존/);
    assert.match(prompt, /blocks\.rows와 latexText의 :::table에 동일한 행 구분과 열 수/);
    assert.match(prompt, /분자식·이온식[\s\S]*\\mathrm\{\.\.\.\}/);
    assert.match(prompt, /숫자 아래첨자, 전하의 위첨자와 부호를 그대로 보존/);
    assert.match(prompt, /물리·수학 변수는 기본 수학 이탤릭을 유지/);
    assert.match(prompt, /기하 도형의 점 이름이나 유전자 기호/);
    assert.doesNotMatch(prompt, /병합 셀은 첫 해당 칸에 한 번만 적고/);
  }
});

test('prompt JSON examples decode real newlines while keeping n-prefixed TeX commands', async (context) => {
  const prompt = await capturePrompt('compatible', context);
  const example = prompt.match(/줄바꿈과 명령을 함께 보존한 JSON 예: (\{[^\n]+\})/)[1];
  const decoded = JSON.parse(example).latexText;
  assert.equal(decoded, '첫째 항목\n둘째 항목 $\\nu\\neq\\nabla f$');
  assert.equal(decoded.split('\n').length, 2);
  assert.ok(decoded.endsWith(String.raw`$\nu\neq\nabla f$`));
  assert.match(prompt, /JSON\.parse 후 실제 줄바꿈\(U\+000A\)/);
  assert.match(prompt, /백슬래시\+n을 줄바꿈 대신 남기지 마세요/);
  assert.match(prompt, /배열·cases의 행 구분 명령도 그대로 보존/);
  // The prompt itself must model actual prose line breaks as well.
  assert.ok(prompt.includes('영어 문항의 발문·선택지 보존 규칙:\n영어 지문이어도'));
  assert.ok(!prompt.includes(String.raw`규칙:\n영어 지문이어도`));
});
