const STRUCTURE_PROMPT = "필수 blocks 구조 판독:\nlatexText와 별도로 blocks 배열에 문항 전체를 원문 읽기 순서대로 분해하세요. 상자 밖 발문·질문·선택지는 kind=text, 사각 테두리 속 문장과 <보기>는 kind=box, 행·열 자료표는 kind=table입니다. 문장 상자나 <보기>를 text로 평탄화하지 마세요.\n각 객체는 kind,title,text,rows,header 필드를 모두 포함합니다. text/box는 rows=[],header=false입니다. table은 text=\"\", rows에 셀 문자열, header에 실제 머리행 유무를 넣습니다. 없는 제목은 빈 문자열입니다.\nblocks의 text나 rows 안에 :::box, :::table, HTML을 쓰지 마세요. 테두리는 kind 값으로 전달하며 앱이 그립니다. 상자 제목 때문에 윗 테두리 가운데가 끊긴 <보기>도 하나의 box입니다.\nblocks의 각 내용은 정확히 한 번만 포함하고, 상자 앞뒤 발문과 선택지를 생략하지 마세요. 그림만 있는 영역은 table로 바꾸지 않으며 필요한 내부 표기는 text에 보존하세요. 기존 latexText도 전체 내용을 빠짐없이 제공하세요.\nblocks 형식 예: [{\"kind\":\"text\",\"title\":\"\",\"text\":\"옳은 것을 고르시오.\",\"rows\":[],\"header\":false},{\"kind\":\"box\",\"title\":\"<보기>\",\"text\":\"ㄱ. 조건 A를 확인한다.\\nㄴ. 조건 B를 확인한다.\",\"rows\":[],\"header\":false},{\"kind\":\"text\",\"title\":\"\",\"text\":\"① ㄱ ② ㄴ\",\"rows\":[],\"header\":false}]\n\n표·자료 상자 인식 규칙 (latexText의 읽기 순서를 유지):\n사각 테두리가 있고 내부가 문장인 자료 영역과 <보기>는 각각 별개의 :::box 블록으로 보존하세요. 제목이 실제로 있으면 :::box <보기>처럼 쓰고 없으면 :::box만 쓰세요. 다음 줄부터 상자 안의 문장을 원래 순서와 줄바꿈으로 쓰고, 마지막 별도 줄에 :::를 써서 닫으세요.\n행·열로 나뉜 자료표는 :::table 블록으로 보존하세요. 셀은 | 구분자로 쓰되 모든 행의 열 수를 동일하게 유지하세요. 제목이 실제로 있으면 :::table 제목으로 쓰세요. 실제 머리행이 있을 때만 바로 다음 줄에 | --- | --- | 구분선을 넣으세요. 마지막 별도 줄 :::로 닫으세요. 빈 셀은 빈 칸으로 두고 내용을 추측하지 마세요.\n부분 가로선이 표 전체 너비를 가로지르지 않아도 일부 열의 셀을 위아래로 분할하면 각각 별도 행입니다. 왼쪽 부모 제목이 세로 병합되어 있더라도 오른쪽 세부 셀을 한 행으로 합치지 마세요. 각 세부 행의 제목·조건·모든 수치·단위와 열 대응을 그대로 보존하고, 같은 열의 위아래 값이나 서로 다른 열의 값을 한 셀에 이어 붙이지 마세요. blocks.rows와 latexText의 :::table에 동일한 행 구분과 열 수를 적용하고, 출력 전 모든 값이 원문과 같은 행·열에 한 번씩 있는지 대조하세요.\n각 상자·표 앞뒤에 줄바꿈을 넣으세요. JSON.parse 후 실제 줄바꿈이 되는 정상 JSON 문자열로 응답하세요. 내용은 latexText에 정확히 한 번만 넣고 상자 밖 발문·질문·선택지는 상자 밖에 원래 순서로 보존하세요. 상자에 없는 제목을 만들어 붙이지 마세요.\n그래프 외곽선, 그림, 회로, 수학 행렬, 문장 안의 작은 빈칸·기호 테두리를 자료표로 만들지 마세요. 가로 병합 머리글은 첫 해당 칸에 적고 덮이는 칸은 비워 직사각 격자로 표현하세요. 세로로 병합된 부모 제목은 여러 세부 행의 소속을 명확히 하도록 각 해당 행에 반복할 수 있습니다. 반복 허용은 부모 제목뿐이며 측정값이나 조건을 복제하지 마세요. 복잡한 중첩 구조·표 안 그림은 원문 캡처로 확인하도록 하고 데이터를 만들어내지 마세요.\n셀 내부의 세로선은 수식 안에서는 $|x|$처럼 유지하고, 일반 문자이면 \\|로 이스케이프하세요(JSON에는 \\\\|). 셀 안 여러 문장은 한 줄에 쓰세요. HTML이나 LaTeX array로 자료표를 대신하지 마세요.\n예시(형식만 참고하고 예시 내용을 복사하지 마세요):\n간접 발문\n:::box\n자료 문장\n:::\n직접 발문\n:::box <보기>\nㄱ. 보기 문장\nㄴ. 보기 문장\n:::\n① 선택지\n:::table\n| 구분 | 값 |\n| --- | --- |\n| A | 10 |\n:::\n줄바꿈을 포함한 올바른 구조 JSON 예: {\"latexText\":\"간접 발문\\n:::box\\n자료 문장\\n:::\\n직접 발문\"}\n\n화학식과 물리·수학 변수의 글꼴:\n주변 문장으로 화학식임이 확인된 분자식·이온식의 원소 기호는 수식 안에서 \\mathrm{...}로 세운 글꼴을 사용하세요. 원소 순서, 계수, 숫자 아래첨자, 전하의 위첨자와 부호를 그대로 보존하며 반응 화살표와 연산 기호의 위치를 바꾸지 마세요. 속도·질량 등 물리·수학 변수는 기본 수학 이탤릭을 유지하세요. 영문 대문자라는 이유만으로 기하 도형의 점 이름이나 유전자 기호를 화학식으로 바꾸지 마세요.\n\nJSON 줄바꿈과 LaTeX 이스케이프를 구분하세요:\n본문과 보기 목록의 줄바꿈은 JSON 문자열에서 \\n으로 직렬화하여 JSON.parse 후 실제 줄바꿈(U+000A)이 되게 하세요. 파싱된 latexText, blocks.text, indirectStem, directStem, choices에 문자 두 개인 백슬래시+n을 줄바꿈 대신 남기지 마세요. 특히 원문에서 줄이 바뀌는 원형 목록 기호나 ㄱ·ㄴ·ㄷ 항목 앞에 실제 줄바꿈을 유지하세요. LaTeX 명령 \\nu, \\neq, \\nabla의 시작을 줄바꿈으로 바꾸지 말고, 배열·cases의 행 구분 명령도 그대로 보존하세요. JSON은 한 번만 인코딩하고 한 번 파싱한 결과를 기준으로 확인하세요.\n줄바꿈과 명령을 함께 보존한 JSON 예: {\"latexText\":\"첫째 항목\\n둘째 항목 $\\\\nu\\\\neq\\\\nabla f$\"}\n\n";

function scriptPositionPrompt(questions: Array<{ text: string }>) {
  const common = '첨자 위치 보존: 일반 변수의 오른쪽 첨자는 오른쪽에 유지하세요. f_1, f_2 같은 진동수·힘·함수 변수를 핵종으로 해석하거나 왼쪽 위·아래로 옮기지 마세요. 같은 변수나 숫자를 중복하지 마세요. 원문 이미지에 실제로 왼쪽 첨자가 있는 경우에만 그 배치를 보존하세요.\n\n';
  const hasNuclearEvidence = questions.some((question) => /원자핵|핵반응|핵융합|핵분열|동위원소|질량수|양성자|중성자|방사성|원자\s*번호|\{\}\s*[_^]/.test(question.text));
  return common + (hasNuclearEvidence ? NUCLEAR_PRESCRIPT_PROMPT : '');
}

const NUCLEAR_PRESCRIPT_PROMPT = [
  '원자핵 표기의 왼쪽 첨자 판독:',
  '기존 추출문은 잘못된 읽기 순서나 누락을 포함할 수 있으므로 원문 이미지의 실제 배치를 우선하세요. 원소 기호 왼쪽 위의 질량수와 왼쪽 아래의 양성자 수를 구별하고, 오른쪽 첨자나 같은 줄의 숫자로 옮기거나 생략하지 마세요.',
  '왼쪽 첨자의 빈 그룹 {}는 위치를 유지하는 필수 LaTeX 구조이므로 삭제하지 마세요. latexText, blocks.text/rows, indirectStem, directStem, choices의 같은 원자핵 표기는 일관되게 보존하세요.',
  '기존 추출문에 이미 있는 왼쪽 첨자의 위치와 값을 이미지와 대조하세요. 읽히지 않는 질량수·양성자 수·생성 입자를 핵반응 지식, 원소의 대표 동위원소 또는 보존 법칙으로 추측하여 채우지 마세요. 아래 예시는 형식만 참고하고 예시 수치를 복사하지 마세요.',
  '왼쪽 첨자를 보존한 올바른 JSON 예: ' + JSON.stringify({ latexText: '원자핵 $' + String.raw`{}^{2}_{1}\mathrm{H}` + '$' }),
  '예시 JSON을 한 번 파싱하면 원소 기호 H의 왼쪽 위에는 2, 왼쪽 아래에는 1이 놓입니다. LaTeX 백슬래시는 파싱 후 한 개가 되며 빈 그룹 {}도 남아야 합니다.',
].join('\n') + '\n\n';

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
            text: scriptPositionPrompt(questions) + STRUCTURE_PROMPT + "영어 문항의 발문·선택지 보존 규칙:\n영어 지문이어도 한국어 질문을 생략하거나 번역하지 마세요. 한국어 발문, 영어 지문 전체, 배점, 모든 선택지를 latexText와 blocks에 원문 순서대로 빠짐없이 넣으세요. 영어 읽기 지문은 요약하지 마세요.\nchoices의 각 문자열은 반드시 원문 번호를 포함한 \"① 선택지 문장\" 형식으로 쓰세요. latexText와 blocks에서도 별도 선택지는 한 줄에 하나씩 번호와 문장을 함께 보존하세요. 이미지에 없는 선택지나 번호를 만들어 5개를 채우지 마세요.\n어법·어휘 문제처럼 지문 안에 있는 ①~⑤는 해당 단어 앞 원래 위치에 유지하세요. 이 경우 별도 선택지 목록이 없으면 choices=[]이고, 지문 안 번호를 아래로 옮기지 마세요. 응답 전 발문·지문·선택지 문장·번호를 각각 이미지와 대조하세요.\n\n" + `이 이미지는 한국어 시험지에서 문항 전체를 잘라낸 캡처 또는 원문 페이지입니다. 여러 조각이 세로로 이어진 경우 같은 문항의 공통 지문 또는 다음 단·페이지 내용입니다. 그림 위의 간접 발문부터 그림 아래의 직접 발문과 마지막 선택지까지 모두 읽으세요. 아래 대상 문항을 이미지에서 다시 찾아 완전한 문항 구조와 그림 영역을 판독하세요.\n\n${questions.map((question) => `${question.number}번 기존 추출문:\n${question.text}`).join('\n\n')}\n\n문항 구조 규칙:\n1. 하나의 문항은 문항 번호부터 다음 문항 번호 직전까지입니다. 시험지가 2단이면 반드시 같은 단 안에서만 찾으세요.\n2. 그림·표·자료가 있는 문항은 보통 자료 위의 간접 발문, 자료, 자료 아래의 직접 발문, 배점, 선택지 순서입니다. 위와 아래 문장을 빠뜨리지 마세요.\n3. indirectStem에는 그림 위의 설명·간접 발문을, directStem에는 그림 아래의 질문·직접 발문과 배점을 넣으세요. 그림이 없으면 indirectStem은 빈 문자열이고 directStem에 전체 발문을 넣으세요.\n4. choices에는 ①~⑤ 등 모든 선택지를 원문 순서로 각각 넣으세요. 문장을 요약하거나 일부만 반환하지 마세요.\n5. latexText에는 indirectStem, directStem, choices를 원문 읽기 순서로 합친 완전한 문항을 넣으세요. 문항 번호 자체는 제외하세요.\n6. latexText라는 필드명과 무관하게 일반 문장·발문·선택지·단순 숫자와 단위(60 km/h, 65.0 cm)는 평문으로 쓰세요. 일반 한글을 \\text{}로 감싸거나 문장 전체를 $로 감싸지 마세요. 분수·지수·근호·방정식 등 실제 수식에만 $...$ 또는 $$...$$ 구분자와 KaTeX 호환 LaTeX를 사용하세요. 일반 자료표는 LaTeX array 대신 위 표·자료 상자 인식 규칙의 :::table 형식으로 쓰세요. 수학 행렬은 수식으로 유지하세요. 이미지에 실제로 보이는 내용만 복원하며 숫자나 단위를 추측하지 마세요.\n7. questionBox는 해당 문항 전체(간접 발문부터 마지막 선택지까지)의 페이지 기준 0~1 좌표 [x,y,width,height]입니다.\n8. figureBox는 해당 문항의 그림·그래프·표·회로·지도와 그 내부 표기만 포함하는 페이지 기준 좌표입니다. 간접 발문, 직접 발문, 선택지, 다른 문항은 제외하고 questionBox 안에 있어야 합니다.\n9. 그림자료가 없으면 hasFigure=false, figureBox=null입니다. 전달받은 모든 문항 번호를 정확히 한 번씩 반환하세요.\n10. JSON 문자열에서 LaTeX 백슬래시는 반드시 두 번 이스케이프하세요. 올바른 JSON 예: {"latexText":"속력은 60 km/h이다. 식은 $\\\\frac{d}{t}$이다."} 이 예의 JSON을 파싱하면 LaTeX 백슬래시는 한 개가 됩니다. 탭이나 제어문자로 LaTeX 명령을 대신하지 마세요.`,
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
