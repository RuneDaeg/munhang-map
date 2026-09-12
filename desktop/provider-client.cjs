const STRUCTURE_PROMPT = "필수 blocks 구조 판독:\nlatexText와 별도로 blocks 배열에 문항 전체를 원문 읽기 순서대로 분해하세요. 상자 밖 발문·질문·선택지는 kind=text, 사각 테두리 속 문장과 <보기>는 kind=box, 행·열 자료표는 kind=table입니다. 문장 상자나 <보기>를 text로 평탄화하지 마세요.\n각 객체는 kind,title,text,rows,header 필드를 모두 포함합니다. text/box는 rows=[],header=false입니다. table은 text=\"\", rows에 셀 문자열, header에 실제 머리행 유무를 넣습니다. 없는 제목은 빈 문자열입니다.\nblocks의 text나 rows 안에 :::box, :::table, HTML을 쓰지 마세요. 테두리는 kind 값으로 전달하며 앱이 그립니다. 상자 제목 때문에 윗 테두리 가운데가 끊긴 <보기>도 하나의 box입니다.\nblocks의 각 내용은 정확히 한 번만 포함하고, 상자 앞뒤 발문과 선택지를 생략하지 마세요. 그림만 있는 영역은 table로 바꾸지 않으며 필요한 내부 표기는 text에 보존하세요. 기존 latexText도 전체 내용을 빠짐없이 제공하세요.\nblocks 형식 예: [{\"kind\":\"text\",\"title\":\"\",\"text\":\"옳은 것을 고르시오.\",\"rows\":[],\"header\":false},{\"kind\":\"box\",\"title\":\"<보기>\",\"text\":\"ㄱ. 조건 A를 확인한다.\\nㄴ. 조건 B를 확인한다.\",\"rows\":[],\"header\":false},{\"kind\":\"text\",\"title\":\"\",\"text\":\"① ㄱ ② ㄴ\",\"rows\":[],\"header\":false}]\n\n표·자료 상자 인식 규칙 (latexText의 읽기 순서를 유지):\n사각 테두리가 있고 내부가 문장인 자료 영역과 <보기>는 각각 별개의 :::box 블록으로 보존하세요. 제목이 실제로 있으면 :::box <보기>처럼 쓰고 없으면 :::box만 쓰세요. 다음 줄부터 상자 안의 문장을 원래 순서와 줄바꿈으로 쓰고, 마지막 별도 줄에 :::를 써서 닫으세요.\n행·열로 나뉜 자료표는 :::table 블록으로 보존하세요. 셀은 | 구분자로 쓰되 모든 행의 열 수를 동일하게 유지하세요. 제목이 실제로 있으면 :::table 제목으로 쓰세요. 실제 머리행이 있을 때만 바로 다음 줄에 | --- | --- | 구분선을 넣으세요. 마지막 별도 줄 :::로 닫으세요. 빈 셀은 빈 칸으로 두고 내용을 추측하지 마세요.\n부분 가로선이 표 전체 너비를 가로지르지 않아도 일부 열의 셀을 위아래로 분할하면 각각 별도 행입니다. 왼쪽 부모 제목이 세로 병합되어 있더라도 오른쪽 세부 셀을 한 행으로 합치지 마세요. 각 세부 행의 제목·조건·모든 수치·단위와 열 대응을 그대로 보존하고, 같은 열의 위아래 값이나 서로 다른 열의 값을 한 셀에 이어 붙이지 마세요. blocks.rows와 latexText의 :::table에 동일한 행 구분과 열 수를 적용하고, 출력 전 모든 값이 원문과 같은 행·열에 한 번씩 있는지 대조하세요.\n각 상자·표 앞뒤에 줄바꿈을 넣으세요. JSON.parse 후 실제 줄바꿈이 되는 정상 JSON 문자열로 응답하세요. 내용은 latexText에 정확히 한 번만 넣고 상자 밖 발문·질문·선택지는 상자 밖에 원래 순서로 보존하세요. 상자에 없는 제목을 만들어 붙이지 마세요.\n그래프 외곽선, 그림, 회로, 수학 행렬, 문장 안의 작은 빈칸·기호 테두리를 자료표로 만들지 마세요. 가로 병합 머리글은 첫 해당 칸에 적고 덮이는 칸은 비워 직사각 격자로 표현하세요. 세로로 병합된 부모 제목은 여러 세부 행의 소속을 명확히 하도록 각 해당 행에 반복할 수 있습니다. 반복 허용은 부모 제목뿐이며 측정값이나 조건을 복제하지 마세요. 복잡한 중첩 구조·표 안 그림은 원문 캡처로 확인하도록 하고 데이터를 만들어내지 마세요.\n셀 내부의 세로선은 수식 안에서는 $|x|$처럼 유지하고, 일반 문자이면 \\|로 이스케이프하세요(JSON에는 \\\\|). 셀 안 여러 문장은 한 줄에 쓰세요. HTML이나 LaTeX array로 자료표를 대신하지 마세요.\n예시(형식만 참고하고 예시 내용을 복사하지 마세요):\n간접 발문\n:::box\n자료 문장\n:::\n직접 발문\n:::box <보기>\nㄱ. 보기 문장\nㄴ. 보기 문장\n:::\n① 선택지\n:::table\n| 구분 | 값 |\n| --- | --- |\n| A | 10 |\n:::\n줄바꿈을 포함한 올바른 구조 JSON 예: {\"latexText\":\"간접 발문\\n:::box\\n자료 문장\\n:::\\n직접 발문\"}\n\n화학식과 물리·수학 변수의 글꼴:\n주변 문장으로 화학식임이 확인된 분자식·이온식의 원소 기호는 수식 안에서 \\mathrm{...}로 세운 글꼴을 사용하세요. 원소 순서, 계수, 숫자 아래첨자, 전하의 위첨자와 부호를 그대로 보존하며 반응 화살표와 연산 기호의 위치를 바꾸지 마세요. 속도·질량 등 물리·수학 변수는 기본 수학 이탤릭을 유지하세요. 영문 대문자라는 이유만으로 기하 도형의 점 이름이나 유전자 기호를 화학식으로 바꾸지 마세요.\n\nJSON 줄바꿈과 LaTeX 이스케이프를 구분하세요:\n본문과 보기 목록의 줄바꿈은 JSON 문자열에서 \\n으로 직렬화하여 JSON.parse 후 실제 줄바꿈(U+000A)이 되게 하세요. 파싱된 latexText, blocks.text, indirectStem, directStem, choices에 문자 두 개인 백슬래시+n을 줄바꿈 대신 남기지 마세요. 특히 원문에서 줄이 바뀌는 원형 목록 기호나 ㄱ·ㄴ·ㄷ 항목 앞에 실제 줄바꿈을 유지하세요. LaTeX 명령 \\nu, \\neq, \\nabla의 시작을 줄바꿈으로 바꾸지 말고, 배열·cases의 행 구분 명령도 그대로 보존하세요. JSON은 한 번만 인코딩하고 한 번 파싱한 결과를 기준으로 확인하세요.\n줄바꿈과 명령을 함께 보존한 JSON 예: {\"latexText\":\"첫째 항목\\n둘째 항목 $\\\\nu\\\\neq\\\\nabla f$\"}\n\n";

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
          latexText: { type: 'string', description: 'Complete question in plain Korean prose; only actual formulas use $...$ LaTeX. No prose text wrappers. Use :::box / :::table blocks for bordered prose and data tables.' },
          blocks: {"type":"array","description":"Complete question in visual reading order. Every prose box including <보기> MUST be a box block; data grids are table blocks. Include all outside stems and choices as text blocks. Do not flatten boxes into text.","items":{"type":"object","properties":{"kind":{"type":"string","enum":["text","box","table"]},"title":{"type":"string","description":"Visible box/table title only; otherwise empty string."},"text":{"type":"string","description":"text/box content; empty string for tables. Ordinary Korean prose and $...$ formulas only."},"rows":{"type":"array","items":{"type":"array","items":{"type":"string"}},"description":"Table cell strings in rectangular rows; [] for text/box."},"header":{"type":"boolean","description":"True only if table has a real header row, false otherwise."}},"required":["kind","title","text","rows","header"],"additionalProperties":false}},
          indirectStem: { type: 'string' },
          directStem: { type: 'string' },
          choices: { type: 'array', items: { type: 'string', description: 'One complete choice including its original circled label, e.g. ① Choice text. No separate list for inline grammar markers; use [].' } },
          questionBox: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
          hasFigure: { type: 'boolean' },
          figureBox: {
            anyOf: [
              { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
              { type: 'null' },
            ],
          },
        },
        required: ['number', 'latexText', 'blocks', 'indirectStem', 'directStem', 'choices', 'questionBox', 'hasFigure', 'figureBox'],
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
  return STRUCTURE_PROMPT + "영어 문항의 발문·선택지 보존 규칙:\n영어 지문이어도 한국어 질문을 생략하거나 번역하지 마세요. 한국어 발문, 영어 지문 전체, 배점, 모든 선택지를 latexText와 blocks에 원문 순서대로 빠짐없이 넣으세요. 영어 읽기 지문은 요약하지 마세요.\nchoices의 각 문자열은 반드시 원문 번호를 포함한 \"① 선택지 문장\" 형식으로 쓰세요. latexText와 blocks에서도 별도 선택지는 한 줄에 하나씩 번호와 문장을 함께 보존하세요. 이미지에 없는 선택지나 번호를 만들어 5개를 채우지 마세요.\n어법·어휘 문제처럼 지문 안에 있는 ①~⑤는 해당 단어 앞 원래 위치에 유지하세요. 이 경우 별도 선택지 목록이 없으면 choices=[]이고, 지문 안 번호를 아래로 옮기지 마세요. 응답 전 발문·지문·선택지 문장·번호를 각각 이미지와 대조하세요.\n\n" + `이 이미지는 한국어 시험지에서 문항 전체를 잘라낸 캡처 또는 원문 페이지입니다. 여러 조각이 세로로 이어진 경우 같은 문항의 공통 지문 또는 다음 단·페이지 내용입니다. 그림 위의 간접 발문부터 그림 아래의 직접 발문과 마지막 선택지까지 모두 읽으세요. 아래 대상 문항을 이미지에서 다시 찾아 완전한 문항 구조와 그림 영역을 판독하세요. 반드시 JSON 스키마에 맞는 JSON만 반환하세요.\n\n${questions.map((question) => `${question.number}번 기존 추출문:\n${question.text}`).join('\n\n')}\n\n문항 구조 규칙:\n1. 하나의 문항은 문항 번호부터 다음 문항 번호 직전까지입니다. 시험지가 2단이면 반드시 같은 단 안에서만 찾으세요.\n2. 그림·표·자료가 있는 문항은 보통 자료 위의 간접 발문, 자료, 자료 아래의 직접 발문, 배점, 선택지 순서입니다. 위와 아래 문장을 빠뜨리지 마세요.\n3. indirectStem에는 그림 위의 설명·간접 발문을, directStem에는 그림 아래의 질문·직접 발문과 배점을 넣으세요. 그림이 없으면 indirectStem은 빈 문자열이고 directStem에 전체 발문을 넣으세요.\n4. choices에는 ①~⑤ 등 모든 선택지를 원문 순서로 각각 넣으세요. 문장을 요약하거나 일부만 반환하지 마세요.\n5. latexText에는 indirectStem, directStem, choices를 원문 읽기 순서로 합친 완전한 문항을 넣으세요. 문항 번호 자체는 제외하세요.\n6. latexText라는 필드명과 무관하게 일반 문장·발문·선택지·단순 숫자와 단위(60 km/h, 65.0 cm)는 평문으로 쓰세요. 일반 한글을 \\text{}로 감싸거나 문장 전체를 $로 감싸지 마세요. 분수·지수·근호·방정식 등 실제 수식에만 $...$ 또는 $$...$$ 구분자와 KaTeX 호환 LaTeX를 사용하세요. 일반 자료표는 LaTeX array 대신 위 표·자료 상자 인식 규칙의 :::table 형식으로 쓰세요. 수학 행렬은 수식으로 유지하세요. 이미지에 실제로 보이는 내용만 복원하며 숫자나 단위를 추측하지 마세요.\n7. questionBox는 해당 문항 전체(간접 발문부터 마지막 선택지까지)의 페이지 기준 0~1 좌표 [x,y,width,height]입니다.\n8. figureBox는 해당 문항의 그림·그래프·표·회로·지도와 그 내부 표기만 포함하는 페이지 기준 좌표입니다. 간접 발문, 직접 발문, 선택지, 다른 문항은 제외하고 questionBox 안에 있어야 합니다.\n9. 그림자료가 없으면 hasFigure=false, figureBox=null입니다. 전달받은 모든 문항 번호를 정확히 한 번씩 반환하세요.\n10. JSON 문자열에서 LaTeX 백슬래시는 반드시 두 번 이스케이프하세요. 올바른 JSON 예: {"latexText":"속력은 60 km/h이다. 식은 $\\\\frac{d}{t}$이다."} 이 예의 JSON을 파싱하면 LaTeX 백슬래시는 한 개가 됩니다. 탭이나 제어문자로 LaTeX 명령을 대신하지 마세요.`;
}

module.exports = {
  PROVIDERS,
  RESULT_SCHEMA,
  keyHint,
  normalizeConnection,
  providerInfo,
  recognize,
};
