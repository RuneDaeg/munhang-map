export type AnalyzedQuestion = {
  number: number;
  type: string;
  text: string;
  standardCode: string;
  standard: string;
  confidence: number;
  domain: string;
};

type Standard = {
  code: string;
  statement: string;
  domain: string;
  keywords: string[];
};

const standards: Record<string, Standard[]> = {
  physics: [
    { code: '[12물리01-01]', domain: '역학과 에너지', statement: '여러 가지 물체의 운동 사례를 찾아 속력의 변화와 운동 방향의 변화에 따라 분류할 수 있다.', keywords: ['속력', '속도', '운동', '위치', '시간', '가속도'] },
    { code: '[12물리01-05]', domain: '역학과 에너지', statement: '충격량과 운동량의 관계를 이해하고 일상생활에서 충격을 감소시키는 예를 찾을 수 있다.', keywords: ['운동량', '충격량', '충돌', '질량', '힘'] },
    { code: '[12물리02-01]', domain: '물질과 전자기장', statement: '전자가 원자에 속박되어 있음을 전기력을 이용하여 정성적으로 설명할 수 있다.', keywords: ['전자', '전기력', '원자', '전하', '전기장'] },
    { code: '[12물리03-02]', domain: '파동과 정보통신', statement: '파동의 간섭이 활용되는 예를 찾아 그 원리를 설명할 수 있다.', keywords: ['파동', '진동수', '파장', '간섭', '전자기파'] },
  ],
  math: [
    { code: '[12수학I01-02]', domain: '지수함수와 로그함수', statement: '지수함수와 로그함수의 뜻을 알고 그 그래프를 그릴 수 있다.', keywords: ['지수', '로그', '그래프', '밑'] },
    { code: '[12수학I02-03]', domain: '삼각함수', statement: '사인법칙과 코사인법칙을 이해하고 이를 활용할 수 있다.', keywords: ['삼각형', '사인', '코사인', '각', '길이'] },
    { code: '[12수학II02-05]', domain: '미분', statement: '함수의 증가와 감소, 극대와 극소를 판정하고 설명할 수 있다.', keywords: ['미분', '극대', '극소', '접선', '증가', '감소'] },
  ],
  science: [
    { code: '[9과01-02]', domain: '힘과 운동', statement: '물체의 운동을 시간에 따른 위치 변화로 나타내고 설명할 수 있다.', keywords: ['운동', '위치', '속력', '시간', '힘'] },
    { code: '[9과03-03]', domain: '생명 시스템', statement: '생명 활동에 필요한 에너지의 생성 과정을 이해하고 설명할 수 있다.', keywords: ['세포', '에너지', '호흡', '광합성', '생명'] },
    { code: '[9과04-02]', domain: '지구 시스템', statement: '지구 시스템을 구성하는 권역 사이의 상호작용을 설명할 수 있다.', keywords: ['지구', '대기', '해양', '기후', '상호작용'] },
  ],
};

export async function analyzePdf(file: File, subject: string) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const source = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: source }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push(text);
  }

  if (!pages.length || pages.join('').length < 40) {
    throw new Error('텍스트를 읽을 수 없는 스캔 PDF입니다. OCR 연결이 필요합니다.');
  }

  const chunks = splitIntoQuestions(pages);
  const catalog = standards[subject] ?? standards.physics;
  return {
    pageCount: pdf.numPages,
    questions: chunks.slice(0, 50).map((text, index) => mapQuestion(text, index + 1, catalog)),
  };
}

function splitIntoQuestions(pages: string[]) {
  const text = pages.join(' \n ');
  const marker = /(?:^|\s)(\d{1,2})\s*[.)]\s+/g;
  const matches = [...text.matchAll(marker)].filter((match) => Number(match[1]) > 0 && Number(match[1]) <= 50);
  if (matches.length >= 2) {
    return matches.map((match, index) => {
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? text.length;
      return text.slice(start, end).trim();
    }).filter((chunk) => chunk.length > 12);
  }
  return pages.filter((page) => page.length > 12);
}

function mapQuestion(text: string, number: number, catalog: Standard[]): AnalyzedQuestion {
  const ranked = catalog.map((standard) => ({
    standard,
    hits: standard.keywords.filter((keyword) => text.includes(keyword)).length,
  })).sort((a, b) => b.hits - a.hits);
  const best = ranked[0];
  const confidence = Math.min(97, 64 + best.hits * 11 + Math.min(8, Math.floor(text.length / 90)));
  return {
    number,
    type: '자동 추출 문항',
    text: text.slice(0, 900),
    standardCode: best.standard.code,
    standard: best.standard.statement,
    confidence,
    domain: best.standard.domain,
  };
}
