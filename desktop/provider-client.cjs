const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultInputPrice: 0.15,
    defaultOutputPrice: 0.6,
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-5',
    defaultInputPrice: 2,
    defaultOutputPrice: 10,
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    defaultInputPrice: 0.3,
    defaultOutputPrice: 2.5,
  },
  compatible: {
    label: 'OpenAI 호환/로컬',
    defaultModel: '',
    defaultInputPrice: 0,
    defaultOutputPrice: 0,
  },
};

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          latexText: { type: 'string' },
          indirectStem: { type: 'string' },
          directStem: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          questionBox: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
          hasFigure: { type: 'boolean' },
          figureBox: {
            anyOf: [
              { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
              { type: 'null' },
            ],
          },
        },
        required: ['number', 'latexText', 'indirectStem', 'directStem', 'choices', 'questionBox', 'hasFigure', 'figureBox'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

function providerInfo(provider) {
  return PROVIDERS[provider] || null;
}

function normalizeConnection(input, existing = null) {
  const provider = typeof input?.provider === 'string' ? input.provider : '';
  const info = providerInfo(provider);
  if (!info) throw new Error('지원하는 API 공급자를 선택해 주세요.');

  const preservedKey = existing?.provider === provider ? existing.apiKey : '';
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim()
    ? input.apiKey.trim()
    : preservedKey;
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim()
    : info.defaultModel;
  const baseUrl = provider === 'compatible' ? normalizeBaseUrl(input.baseUrl) : '';
  if (!model) throw new Error('사용할 모델 ID를 입력해 주세요.');
  if (!apiKey && !(provider === 'compatible' && isLoopbackUrl(baseUrl))) {
    throw new Error('API 키를 입력해 주세요. 로컬 OpenAI 호환 서버만 키 없이 연결할 수 있습니다.');
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl,
    budgetUsd: optionalNumber(input.budgetUsd),
    inputPrice: optionalNumber(input.inputPrice, info.defaultInputPrice),
    outputPrice: optionalNumber(input.outputPrice, info.defaultOutputPrice),
  };
}

function normalizeBaseUrl(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!text) throw new Error('OpenAI 호환 API의 기본 주소를 입력해 주세요.');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('API 기본 주소 형식을 확인해 주세요.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 주소에는 인증 정보나 쿼리를 넣을 수 없습니다.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('원격 API는 HTTPS 주소만 허용합니다. HTTP는 이 컴퓨터의 로컬 서버만 사용할 수 있습니다.');
  }
  return url.toString().replace(/\/$/, '');
}

function isLoopbackUrl(value) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function optionalNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('예산과 단가는 0 이상의 숫자로 입력해 주세요.');
  return number;
}

function keyHint(connection) {
  if (!connection?.apiKey) return '키 없음 · 로컬 서버';
  const suffix = connection.apiKey.slice(-4);
  const prefix = connection.provider === 'openai'
    ? 'sk-…'
    : connection.provider === 'anthropic'
      ? 'sk-ant-…'
      : connection.provider === 'gemini'
        ? 'AIza…'
        : '••••…';
  return `${prefix}${suffix}`;
}

function validateRecognitionBody(body) {
  if (!body?.image?.startsWith('data:image/jpeg;base64,') || body.image.length > 7_000_000) {
    throw new Error('분석할 PDF 페이지 이미지가 올바르지 않습니다.');
  }
  const questions = Array.isArray(body.questions)
    ? body.questions.slice(0, 20).filter((question) => Number.isFinite(question.number) && typeof question.text === 'string' && question.text)
    : [];
  if (!questions.length) throw new Error('분석할 문항이 없습니다.');
  return { image: body.image, questions };
}

async function recognize(connection, body) {
  const input = validateRecognitionBody(body);
  if (connection.provider === 'openai') return callOpenAI(connection, input);
  if (connection.provider === 'anthropic') return callAnthropic(connection, input);
  if (connection.provider === 'gemini') return callGemini(connection, input);
  if (connection.provider === 'compatible') return callCompatible(connection, input);
  throw new Error('지원하지 않는 API 공급자입니다.');
}

async function callOpenAI(connection, input) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.model,
      store: false,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: makePrompt(input.questions) },
          { type: 'input_image', image_url: input.image, detail: 'high' },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'exam_page_recognition', strict: true, schema: RESULT_SCHEMA } },
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(apiError(payload, 'OpenAI 비전 분석 요청에 실패했습니다.'));
  const text = payload?.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  return parsedResult(text, {
    inputTokens: payload?.usage?.input_tokens,
    outputTokens: payload?.usage?.output_tokens,
  });
}

async function callAnthropic(connection, input) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': connection.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: connection.model,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.image.split(',')[1] } },
          { type: 'text', text: makePrompt(input.questions) },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(apiError(payload, 'Anthropic 비전 분석 요청에 실패했습니다.'));
  const text = payload?.content?.find((item) => item.type === 'text')?.text;
  const cachedInput = Number(payload?.usage?.cache_creation_input_tokens || 0) + Number(payload?.usage?.cache_read_input_tokens || 0);
  return parsedResult(text, {
    inputTokens: Number(payload?.usage?.input_tokens || 0) + cachedInput,
    outputTokens: payload?.usage?.output_tokens,
  });
}

async function callGemini(connection, input) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(connection.model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'x-goog-api-key': connection.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: makePrompt(input.questions) },
          { inlineData: { mimeType: 'image/jpeg', data: input.image.split(',')[1] } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: RESULT_SCHEMA,
      },
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(apiError(payload, 'Gemini 비전 분석 요청에 실패했습니다.'));
  const text = payload?.candidates?.[0]?.content?.parts?.find((item) => typeof item.text === 'string')?.text;
  return parsedResult(text, {
    inputTokens: payload?.usageMetadata?.promptTokenCount,
    outputTokens: payload?.usageMetadata?.candidatesTokenCount,
  });
}

async function callCompatible(connection, input) {
  const endpoint = connection.baseUrl.endsWith('/chat/completions')
    ? connection.baseUrl
    : `${connection.baseUrl}/chat/completions`;
  const requestBody = {
    model: connection.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: makePrompt(input.questions) },
        { type: 'image_url', image_url: { url: input.image } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'exam_page_recognition', strict: true, schema: RESULT_SCHEMA },
    },
  };
  let response = await compatibleFetch(endpoint, connection.apiKey, requestBody);
  if ((response.status === 400 || response.status === 422) && requestBody.response_format) {
    response = await compatibleFetch(endpoint, connection.apiKey, { ...requestBody, response_format: undefined });
  }
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(apiError(payload, 'OpenAI 호환 비전 분석 요청에 실패했습니다.'));
  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.find((item) => item.type === 'text')?.text
      : '';
  return parsedResult(text, {
    inputTokens: payload?.usage?.prompt_tokens,
    outputTokens: payload?.usage?.completion_tokens,
  });
}

function compatibleFetch(endpoint, apiKey, body) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function readPayload(response) {
  return response.json().catch(() => null);
}

function apiError(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

function parsedResult(text, usage) {
  if (!text) throw new Error('비전 분석 결과가 비어 있습니다.');
  let value;
  try {
    value = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error('비전 분석 결과 형식을 읽지 못했습니다.');
  }
  if (!Array.isArray(value?.questions)) throw new Error('비전 분석 결과에 문항 배열이 없습니다.');
  return {
    result: value,
    usage: {
      inputTokens: finiteTokenCount(usage.inputTokens),
      outputTokens: finiteTokenCount(usage.outputTokens),
    },
  };
}

function stripJsonFence(value) {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function finiteTokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function makePrompt(questions) {
  return `이 이미지는 한국어 시험지의 한 페이지입니다. 아래 대상 문항을 이미지에서 다시 찾아 완전한 문항 구조와 그림 영역을 판독하세요. 반드시 JSON 스키마에 맞는 JSON만 반환하세요.\n\n${questions.map((question) => `${question.number}번 기존 추출문:\n${question.text}`).join('\n\n')}\n\n문항 구조 규칙:\n1. 하나의 문항은 문항 번호부터 다음 문항 번호 직전까지입니다. 시험지가 2단이면 반드시 같은 단 안에서만 찾으세요.\n2. 그림·표·자료가 있는 문항은 보통 자료 위의 간접 발문, 자료, 자료 아래의 직접 발문, 배점, 선택지 순서입니다. 위와 아래 문장을 빠뜨리지 마세요.\n3. indirectStem에는 그림 위의 설명·간접 발문을, directStem에는 그림 아래의 질문·직접 발문과 배점을 넣으세요. 그림이 없으면 indirectStem은 빈 문자열이고 directStem에 전체 발문을 넣으세요.\n4. choices에는 ①~⑤ 등 모든 선택지를 원문 순서로 각각 넣으세요. 문장을 요약하거나 일부만 반환하지 마세요.\n5. latexText에는 indirectStem, directStem, choices를 원문 읽기 순서로 합친 완전한 문항을 넣으세요. 문항 번호 자체는 제외하세요.\n6. 원문에 실제로 보이는 수식·숫자·단위만 복원하고, 수식과 과학 단위는 KaTeX 호환 LaTeX로 바꾸세요. 일반 한글은 LaTeX의 \\text{}로 감싸지 마세요.\n7. questionBox는 해당 문항 전체(간접 발문부터 마지막 선택지까지)의 페이지 기준 0~1 좌표 [x,y,width,height]입니다.\n8. figureBox는 해당 문항의 그림·그래프·표·회로·지도와 그 내부 표기만 포함하는 페이지 기준 좌표입니다. 간접 발문, 직접 발문, 선택지, 다른 문항은 제외하고 questionBox 안에 있어야 합니다.\n9. 그림자료가 없으면 hasFigure=false, figureBox=null입니다. 전달받은 모든 문항 번호를 정확히 한 번씩 반환하세요.`;
}

module.exports = {
  PROVIDERS,
  RESULT_SCHEMA,
  keyHint,
  normalizeConnection,
  providerInfo,
  recognize,
};
