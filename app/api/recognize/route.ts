const MODEL = 'gpt-4o-mini';

export async function GET() {
  return Response.json({ available: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: '로컬 OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 503 });

  const body = await request.json().catch(() => null) as { image?: string; questions?: Array<{ number: number; text: string }> } | null;
  if (!body?.image?.startsWith('data:image/jpeg;base64,') || body.image.length > 7_000_000) {
    return Response.json({ error: '분석할 PDF 페이지 이미지가 올바르지 않습니다.' }, { status: 400 });
  }
  const questions = body.questions?.slice(0, 20).filter((question) => Number.isFinite(question.number) && question.text) ?? [];
  if (!questions.length) return Response.json({ error: '분석할 문항이 없습니다.' }, { status: 400 });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `이 이미지는 한국어 시험지의 한 페이지입니다. 아래 대상 문항을 이미지에서 다시 찾아 완전한 문항 구조와 그림 영역을 판독하세요.\n\n${questions.map((question) => `${question.number}번 기존 추출문:\n${question.text}`).join('\n\n')}\n\n문항 구조 규칙:\n1. 하나의 문항은 문항 번호부터 다음 문항 번호 직전까지입니다. 시험지가 2단이면 반드시 같은 단 안에서만 찾으세요.\n2. 그림·표·자료가 있는 문항은 보통 자료 위의 간접 발문, 자료, 자료 아래의 직접 발문, 배점, 선택지 순서입니다. 위와 아래 문장을 빠뜨리지 마세요.\n3. indirectStem에는 그림 위의 설명·간접 발문을, directStem에는 그림 아래의 질문·직접 발문과 배점을 넣으세요. 그림이 없으면 indirectStem은 빈 문자열이고 directStem에 전체 발문을 넣으세요.\n4. choices에는 ①~⑤ 등 모든 선택지를 원문 순서로 각각 넣으세요. 문장을 요약하거나 일부만 반환하지 마세요.\n5. latexText에는 indirectStem, directStem, choices를 원문 읽기 순서로 합친 완전한 문항을 넣으세요. 문항 번호 자체는 제외하세요.\n6. 원문에 실제로 보이는 수식·숫자·단위만 복원하고, 수식과 과학 단위는 KaTeX 호환 LaTeX로 바꾸세요. 일반 한글은 LaTeX의 \\text{}로 감싸지 마세요.\n7. questionBox는 해당 문항 전체(간접 발문부터 마지막 선택지까지)의 페이지 기준 0~1 좌표 [x,y,width,height]입니다.\n8. figureBox는 해당 문항의 그림·그래프·표·회로·지도와 그 내부 표기만 포함하는 페이지 기준 좌표입니다. 간접 발문, 직접 발문, 선택지, 다른 문항은 제외하고 questionBox 안에 있어야 합니다.\n9. 그림자료가 없으면 hasFigure=false, figureBox=null입니다. 전달받은 모든 문항 번호를 정확히 한 번씩 반환하세요.`,
          },
          { type: 'input_image', image_url: body.image, detail: 'high' },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'exam_page_recognition',
          strict: true,
          schema: {
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
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null) as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } } | null;
  if (!response.ok) return Response.json({ error: payload?.error?.message ?? 'OpenAI 비전 분석 요청에 실패했습니다.' }, { status: response.status });
  const outputText = payload?.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) return Response.json({ error: '비전 분석 결과가 비어 있습니다.' }, { status: 502 });
  try {
    return Response.json(JSON.parse(outputText));
  } catch {
    return Response.json({ error: '비전 분석 결과 형식을 읽지 못했습니다.' }, { status: 502 });
  }
}
