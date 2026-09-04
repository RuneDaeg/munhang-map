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
    global.fetch = async () => new Response(JSON.stringify(item.response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const output = await recognize(item.connection, { image, questions });
    assert.equal(output.result.questions[0].number, 1);
    assert.deepEqual([output.usage.inputTokens, output.usage.outputTokens], item.expected);
  }
});
