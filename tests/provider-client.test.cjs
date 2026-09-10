/* oxlint-disable typescript/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConnection, recognize } = require('../desktop/provider-client.cjs');

const image = 'data:image/jpeg;base64,/9j/2Q==';
const questions = [{ number: 1, text: '그림을 보고 옳은 것을 고르시오.' }];
const result = {
  questions: [{
    number: 1,
    latexText: '옳은 것을 고르시오.',
    blocks: [{ kind: 'text', title: '', text: '옳은 것을 고르시오.', rows: [], header: false }],
    indirectStem: '',
    directStem: '옳은 것을 고르시오.',
    choices: [],
    questionBox: [0.1, 0.1, 0.8, 0.8],
    hasFigure: false,
    figureBox: null,
  }],
};

void test('normalizes provider connections and protects remote HTTP endpoints', () => {
  const local = normalizeConnection({ provider: 'compatible', model: 'vision', baseUrl: 'http://127.0.0.1:11434/v1' });
  assert.equal(local.apiKey, '');
  assert.throws(() => normalizeConnection({ provider: 'compatible', model: 'vision', baseUrl: 'http://example.com/v1', apiKey: 'secret' }), /HTTPS/);
});

void test('recognizes with OpenAI, Anthropic, Gemini, and compatible response formats', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const cases = [
    {
      connection: normalizeConnection({ provider: 'openai', apiKey: 'openai-test-key', model: 'gpt-4o-mini' }),
      response: { output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 11, output_tokens: 7 } },
      expected: [11, 7],
    },
    {
      connection: normalizeConnection({ provider: 'anthropic', apiKey: 'anthropic-test-key', model: 'claude-sonnet-5' }),
      response: { content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 12, cache_read_input_tokens: 2, output_tokens: 8 } },
      expected: [14, 8],
    },
    {
      connection: normalizeConnection({ provider: 'gemini', apiKey: 'gemini-test-key', model: 'gemini-2.5-flash' }),
      response: { candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }], usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 9 } },
      expected: [13, 9],
    },
    {
      connection: normalizeConnection({ provider: 'compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'vision' }),
      response: { choices: [{ message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 14, completion_tokens: 10 } },
      expected: [14, 10],
    },
  ];

  for (const item of cases) {
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      const schema = item.connection.provider === 'openai' ? body.text.format.schema
        : item.connection.provider === 'anthropic' ? body.output_config.format.schema
          : item.connection.provider === 'gemini' ? body.generationConfig.responseJsonSchema
            : body.response_format.json_schema.schema;
      assert.ok(schema.properties.questions.items.required.includes('blocks'));
      assert.deepEqual(schema.properties.questions.items.properties.blocks.items.properties.kind.enum, ['text', 'box', 'table']);
      const prompt = item.connection.provider === 'openai' ? body.input[0].content[0].text
        : item.connection.provider === 'gemini' ? body.contents[0].parts[0].text
          : body.messages[0].content.find((part) => part.type === 'text').text;
      assert.match(prompt, /일반 문장·발문·선택지·단순 숫자와 단위/);
      assert.match(prompt, /한국어 질문을 생략하거나 번역하지 마세요/);
      assert.match(prompt, /원문 번호를 포함한/);
      assert.match(prompt, /지문 안 번호를 아래로 옮기지 마세요/);
      assert.match(prompt, /일반 자료표는 LaTeX array 대신/);
      assert.match(prompt, /:::box/);
      assert.match(prompt, /:::table/);
      assert.match(prompt, /그래프 외곽선/);
      assert.ok(prompt.includes('\n:::box\n자료 문장\n:::\n'));
      const structureExample = prompt.match(/줄바꿈을 포함한 올바른 구조 JSON 예: (\{[^\n]*\})/)[1];
      assert.equal(JSON.parse(structureExample).latexText, '간접 발문\n:::box\n자료 문장\n:::\n직접 발문');
      const example = prompt.match(/올바른 JSON 예: (\{[^\n]*?\}) 이 예/)[1];
      assert.equal(JSON.parse(example).latexText, String.raw`속력은 60 km/h이다. 식은 $\frac{d}{t}$이다.`);
      return new Response(JSON.stringify(item.response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const output = await recognize(item.connection, { image, questions });
    assert.equal(output.result.questions[0].number, 1);
    assert.deepEqual(output.result.questions[0].blocks, result.questions[0].blocks);
    assert.deepEqual([output.usage.inputTokens, output.usage.outputTokens], item.expected);
  }
});
