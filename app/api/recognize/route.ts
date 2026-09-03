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
            text: `이 이미지는 한국어 시험지의 한 페이지입니다. 아래 문항별로 이미지 원문을 확인해 텍스트 추출 오류를 교정하세요.\n\n${questions.map((question) => `${question.number}번: ${question.text}`).join('\n\n')}\n\n규칙:\n1. 원문에 실제로 보이는 수식, 숫자, 단위만 복원하고 추측하지 마세요.\n2. 수식과 과학 단위는 KaTeX 호환 LaTeX로 바꾸고 인라인은 $...$, 독립 수식은 $$...$$로 감싸세요.\n3. 문항에 딸린 그림, 그래프, 표, 회로, 지도 또는 자료 화면이 있으면 그 자료만 포함하는 사각형을 페이지 전체 기준 0~1 좌표 [x,y,width,height]로 반환하세요. 문제 지문과 선택지는 사각형에서 최대한 제외하세요.\n4. 그림자료가 없으면 hasFigure=false, figureBox=null입니다.\n5. 전달받은 모든 문항 번호를 한 번씩 반환하세요.`,
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
                    hasFigure: { type: 'boolean' },
                    figureBox: {
                      anyOf: [
                        { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
                        { type: 'null' },
                      ],
                    },
                  },
                  required: ['number', 'latexText', 'hasFigure', 'figureBox'],
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
