/** Local review candidates, not calibrated confidence or curriculum gold labels.
 * Input/output records are structural types to avoid importing pdf-analysis.
 * Every candidate is an unchanged row of the supplied catalogue.
 */
export type CatalogRecord = {
  school: string;
  subject: string;
  grade: string;
  code: string;
  statement: string;
};
export type MappingQuestion = {
  number: number;
  text: string;
  assessmentText?: string;
  selectedSubjectKey?: string;
  examSubject?: { label: string; subjectKeys: string[] };
  sharedPassage?: { range: [number, number]; text: string; pages: number[] };
  analysisWarning?: string;
  captureWarning?: string;
  captureReviewed?: boolean;
  textEdited?: boolean;
};
export type AssessmentArea =
  | 'speech'
  | 'reading'
  | 'writing'
  | 'grammar'
  | 'literature'
  | 'media'
  | 'math-power-log'
  | 'math-trigonometry'
  | 'math-sequence'
  | 'math-limit'
  | 'math-differentiation'
  | 'math-integration'
  | 'math-probability'
  | 'math-statistics'
  | 'math-combinatorics'
  | 'math-algebra'
  | 'math-function'
  | 'math-geometry'
  | 'math-set'
  | 'math-matrix';
export type MappingCandidate = {
  code: string;
  standard: string;
  domain: string;
  subjectKey: string;
  rankScore: number;
  reason: string;
};
export type AssessmentMapping = {
  version: 1;
  method: 'local-assessment-rules';
  status: 'candidate' | 'needs-source-review' | 'unknown';
  area?: AssessmentArea;
  areaLabel?: string;
  element?: string;
  reason: string;
  assessmentEvidence: string;
  candidates: MappingCandidate[];
  checks: {
    catalogMembership: boolean;
    subjectScope: boolean;
    areaRestriction: boolean;
    ownQuestionAvailable: boolean;
    unresolvedGlyphCount: number;
    hasSourceWarning: boolean;
    sourceCompared: 'not-checked';
  };
};
type Rule = {
  area: AssessmentArea;
  label: string;
  element: string;
  test: RegExp;
  statements: RegExp;
  preferred?: RegExp;
};
const compact = (value: string) => value.normalize('NFKC').replace(/\s/g, '');
const key = (row: CatalogRecord) => `${row.school}|${row.subject}`;
const koreanSubjects = new Set([
  '국어',
  '공통국어1',
  '공통국어2',
  '화법과 언어',
  '독서와 작문',
  '문학',
  '독서 토론과 글쓰기',
  '매체 의사소통',
  '언어생활 탐구',
]);
const mathSubjects = new Set([
  '수학',
  '공통수학1',
  '공통수학2',
  '대수',
  '미적분Ⅰ',
  '미적분Ⅱ',
  '기하',
  '확률과 통계',
]);

/** Prefer the structured own region. Legacy shared passages are never scored. */
export function ownAssessmentText(question: MappingQuestion): string {
  if (!question.textEdited && question.assessmentText !== undefined)
    return question.assessmentText.trim();
  const plain = question.text.replace(/<\/?[bu]>/g, '');
  const re = new RegExp(`(?:^|\\n)\\s*${question.number}\\s*[.)]\\s*`, 'g');
  const matches = [...plain.matchAll(re)];
  if (matches.length === 1)
    return plain.slice(matches[0].index! + matches[0][0].length).trim();
  if (
    matches.length > 1 ||
    question.sharedPassage ||
    /\[\s*\d+\s*[~～〜–-]\s*\d+\s*\]/.test(question.text)
  )
    return '';
  return question.text.trim();
}

/** Common Korean domain numbers are taken from this app's current catalogue.
 * Mixed courses use their actual statement text, not their course name alone.
 */
export function catalogAreas(row: CatalogRecord): AssessmentArea[] {
  const code = row.code;
  const statement = compact(row.statement);
  if (koreanSubjects.has(row.subject)) {
    const common = code.match(/^\[(?:9국|10공국[12]-)(0[1-6])-/);
    if (common)
      return [
        (
          [
            'speech',
            'reading',
            'writing',
            'grammar',
            'literature',
            'media',
          ] as AssessmentArea[]
        )[Number(common[1]) - 1],
      ];
    if (row.subject === '문학') return ['literature'];
    if (row.subject === '매체 의사소통') return ['media'];
    if (row.subject === '화법과 언어') {
      const n = Number(code.match(/-(\d+)\]$/)?.[1]);
      if (n >= 1 && n <= 6) return ['grammar'];
      if (n >= 8 && n <= 13) return ['speech'];
      return []; // Broad attitudes are not a substitute for an assessed skill.
    }
    if (row.subject === '독서와 작문' || row.subject === '독서 토론과 글쓰기') {
      const areas: AssessmentArea[] = [];
      if (/읽|독서/.test(statement)) areas.push('reading');
      if (/글을쓰|글쓰기|작문|고쳐쓴|글쓴|쓰고/.test(statement))
        areas.push('writing');
      if (/독서토론/.test(statement)) areas.push('speech');
      if (/매체의유형과특성/.test(statement)) areas.push('media');
      return areas;
    }
    return [];
  }
  if (!mathSubjects.has(row.subject)) return [];
  if (row.subject === '대수') {
    const n = Number(code.match(/대수(\d+)-/)?.[1]);
    return n === 1
      ? ['math-power-log']
      : n === 2
        ? ['math-trigonometry']
        : n === 3
          ? ['math-sequence']
          : [];
  }
  if (/^미적분/.test(row.subject)) {
    const section = Number(code.match(/-(\d+)-/)?.[1]);
    if (section === 1) return ['math-limit'];
    if (section === 2)
      return /극한/.test(statement)
        ? ['math-differentiation', 'math-limit']
        : ['math-differentiation'];
    if (section === 3) return ['math-integration'];
  }
  if (row.subject === '확률과 통계') {
    const n = Number(code.match(/확통(\d+)-/)?.[1]);
    return n === 1
      ? ['math-combinatorics']
      : n === 2
        ? ['math-probability']
        : n === 3
          ? ['math-statistics']
          : [];
  }
  if (row.subject === '기하') return ['math-geometry'];
  if (row.subject === '공통수학1') {
    const n = Number(code.match(/-(\d+)-/)?.[1]);
    return n === 3
      ? ['math-combinatorics']
      : n === 4
        ? ['math-matrix']
        : ['math-algebra'];
  }
  if (row.subject === '공통수학2') {
    const n = Number(code.match(/-(\d+)-/)?.[1]);
    return n === 1
      ? ['math-geometry']
      : n === 2
        ? ['math-set']
        : n === 3
          ? ['math-function']
          : [];
  }
  // Middle-school records may share a section: classify the actual statement.
  const result: AssessmentArea[] = [];
  if (/지수법칙|제곱근|근호/.test(statement)) result.push('math-power-log');
  if (/삼각비/.test(statement)) result.push('math-trigonometry');
  if (/확률/.test(statement)) result.push('math-probability');
  if (/통계|대푯값|산포도|상관관계|자료의분포/.test(statement))
    result.push('math-statistics');
  if (/경우의수/.test(statement)) result.push('math-combinatorics');
  if (/방정식|부등식|다항식|인수분해|일차식/.test(statement))
    result.push('math-algebra');
  if (/함수|그래프|정비례|반비례/.test(statement)) result.push('math-function');
  if (/삼각형|사각형|도형|원주각|피타고라스|부채꼴|평행선/.test(statement))
    result.push('math-geometry');
  return result;
}

const koreanRules: Rule[] = [
  {
    area: 'grammar',
    label: '문법',
    element: '국어의 역사와 표기 적용',
    test: /중세국어|옛한글|이어적기|모음조화|국어의변화/,
    statements: /국어.*변화|과거.*국어|국어사/,
  },
  {
    area: 'grammar',
    label: '문법',
    element: '음운·발음 규칙 적용',
    test: /표준발음|음운변동|된소리|겹받침|비음화|구개음화/,
    statements: /음운|표준발음|발음과표기/,
  },
  {
    area: 'grammar',
    label: '문법',
    element: '단어의 짜임과 품사 분석',
    test: /단어의짜임|품사|합성어|파생어|어근|접사/,
    statements: /단어의짜임|품사|단어.*형성/,
  },
  {
    area: 'grammar',
    label: '문법',
    element: '문법 요소와 문장 구조 적용',
    test: /부정문|명사형어미|문법요소|문장구조|피동표현|사동표현|높임표현/,
    statements: /문법요소|문장구조|문장의짜임|피동표현/,
  },
  {
    area: 'writing',
    label: '쓰기',
    element: '고쳐쓰기와 자료 보완',
    test: /고쳐쓴|고쳐쓰|수정후|보완하는방안|글.*수정/,
    statements: /고쳐쓴|고쳐쓰|쓰기과정과전략.*점검/,
  },
  {
    area: 'writing',
    label: '쓰기',
    element: '글쓰기 계획·내용 조직·표현',
    test: /글쓰기계획|글쓰기방식|초고|소감문을쓰기|작성하기위해/,
    statements: /내용.*조직|글쓰기에활용|견해.*글을쓴|정서.*글을쓴/,
    preferred: /내용조직방법|정보.*조직/,
  },
  {
    area: 'speech',
    label: '듣기·말하기',
    element: '협상 전략과 대안',
    test: /협상/,
    statements: /협상/,
  },
  {
    area: 'speech',
    label: '듣기·말하기',
    element: '발표의 말하기 방식과 표현 전략',
    test: /발표자의말하기방식|발표.*말하기|발표.*표현전략/,
    statements: /발표/,
    preferred: /표현전략.*발표/,
  },
  {
    area: 'speech',
    label: '듣기·말하기',
    element: '발표 계획과 청중 고려',
    test: /발표/,
    statements: /발표/,
    preferred: /청중.*내용.*구성/,
  },
  {
    area: 'speech',
    label: '듣기·말하기',
    element: '대화·발화의 기능과 전략',
    test: /말하기|발화|대화방식|사회자.*역할|토의|토론/,
    statements: /대화|토의|토론|협상|듣고말/,
    preferred: /대화의원리|협상/,
  },
  {
    area: 'literature',
    label: '문학',
    element: '작품의 표현과 구성',
    test: /서술자|서술상|시상|형상화|운율|표현상특징|전기적요소|의문형어미.*정서|영탄적표현/,
    statements: /형상화|구성요소|내용과형식|표현방법/,
    preferred: /구성요소|내용과형식/,
  },
  {
    area: 'literature',
    label: '문학',
    element: '인물·작품의 의미와 맥락 이해',
    test: /감상|작품|인물|시적화자|소설|시구|시어/,
    statements: /작품.*수용|작품.*맥락|문학의맥락/,
    preferred: /구성요소|공감적/,
  },
  // Media is selected only if its form/production/reception is the assessment.
  {
    area: 'media',
    label: '매체',
    element: '매체의 표현·제작·수용 방식',
    test: /(?:매체|광고|뉴스|SNS|플랫폼).*(?:제작|생산자|수용자|신뢰성|표현방식|소통방식)|매체특성/,
    statements: /매체/,
    preferred: /특성|표현|제작|신뢰/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '문맥상 어휘 의미 파악',
    test: /문맥상의미|문맥상.*의미|바꾸어쓰/,
    statements: /글에드러난정보|글의내용을파악|정보.*추론하며읽/,
    preferred: /글에드러난정보/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '정보를 새 사례에 적용',
    test: /바탕으로.*보기.*이해|바탕으로.*보기.*반응/,
    statements: /글에드러난정보|글의내용을파악|정보.*추론하며읽/,
    preferred: /글에드러난정보/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '드러나지 않은 정보 추론',
    test: /추론|이유.*짐작/,
    statements: /추론.*읽/,
    preferred: /드러나지않은정보를추론/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '주제 통합과 읽기 방법',
    test: /읽은방법|읽기방법|주제통합/,
    statements: /주제통합|읽기과정|읽는과정/,
    preferred: /주제통합/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '내용 조직과 설명 방식 파악',
    test: /전개방식|설명방식|논증방식|서술방식|내용조직/,
    statements: /내용조직|설명방법|논증방법|표현방법/,
    preferred: /내용조직방법/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '내용·관점·표현의 적절성 평가',
    test: /관점.*평가|논증.*타당|신뢰성|비판/,
    statements: /평가.*읽|타당성.*평가/,
    preferred: /글의내용이나관점/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '핵심 정보 정리',
    test: /정리한메모|내용.*요약/,
    statements: /글에드러난정보|요약|글의내용을파악/,
    preferred: /글에드러난정보/,
  },
  {
    area: 'reading',
    label: '읽기',
    element: '명시된 정보의 일치·이해 확인',
    test: /이해|내용.*일치|알수있는|답을확인|대한설명/,
    statements: /글에드러난정보|글의내용을파악|정보.*추론하며읽/,
    preferred: /글에드러난정보/,
  },
];

function koreanRule(own: string): { rule?: Rule; evidence: string } {
  // A short reference box may interrupt a stem. Rejoin only that inline box;
  // full material boxes remain a boundary between stem and supporting data.
  const restored = own
    .replace(/:::box[^\n]*\n([^\n]{1,60})\n:::/g, '$1')
    .replace(/<\/?[bu]>/g, '');
  const rawStem = restored.split(/①|:::|\n\s*<\s*보\s*기\s*>/)[0].trim();
  const stem = compact(rawStem);
  const full = compact(own);
  // Exact stem indicators take priority; a grammar topic in the shared
  // presentation must not replace a question about the speaker's delivery.
  let rule = koreanRules.find((candidate) => candidate.test.test(stem));
  if (!rule || (rule.area === 'reading' && /이해|대한설명/.test(stem))) {
    const specific = koreanRules.find(
      (candidate) =>
        ['grammar', 'literature'].includes(candidate.area) &&
        candidate.test.test(full),
    );
    if (specific) rule = specific;
    else if (!rule)
      rule = koreanRules.find(
        (candidate) => candidate.area === 'speech' && candidate.test.test(full),
      );
  }
  // Comparison choices reveal the assessed explanation method; their topical
  // legal/science words never enter catalogue ranking.
  if (
    rule?.area === 'reading' &&
    /대한설명/.test(stem) &&
    /분류|사례.*소개|원리.*설명|대조|열거/.test(full)
  ) {
    rule = koreanRules.find(
      (candidate) => candidate.element === '내용 조직과 설명 방식 파악',
    );
  }
  return { rule, evidence: rawStem.replace(/\s+/g, ' ').slice(0, 220) };
}

const mathRules: Rule[] = [
  {
    area: 'math-statistics',
    label: '통계',
    element: '분포와 통계적 추정',
    test: /확률변수|확률분포|확률밀도함수|정규분포|표준편차|표본평균|모평균|신뢰구간|이항분포/,
    statements: /분포|평균|표본|추정/,
  },
  {
    area: 'math-integration',
    label: '적분',
    element: '적분과 활용',
    test: /적분|\\int|∫/,
    statements: /적분|곡선으로둘러싸인|속도와거리/,
  },
  {
    area: 'math-differentiation',
    label: '미분',
    element: '미분과 활용',
    test: /미분|도함수|평균값정리|접선의기울기|[fg][′']/i,
    statements: /미분|도함수|접선|증가와감소|평균값정리/,
  },
  {
    area: 'math-limit',
    label: '극한·연속',
    element: '함수의 연속 조건',
    test: /연속/,
    statements: /연속/,
    preferred: /연속함수/,
  },
  {
    area: 'math-limit',
    label: '극한·연속',
    element: '함수·수열의 극한 계산',
    test: /극한|lim|수렴|발산/i,
    statements: /극한/,
    preferred: /함수의극한값/,
  },
  {
    area: 'math-probability',
    label: '확률',
    element: '확률 계산과 조건',
    test: /확률|사건의독립/,
    statements: /확률|독립과종속/,
  },
  {
    area: 'math-combinatorics',
    label: '경우의 수',
    element: '경우의 수·순열·조합',
    test: /경우의수|순열|조합|이항정리/,
    statements: /경우의수|순열|조합|이항정리/,
  },
  {
    area: 'math-power-log',
    label: '지수·로그',
    element: '거듭제곱근과 지수법칙',
    test: /제곱근|지수법칙/,
    statements: /거듭제곱근|지수법칙/,
    preferred: /거듭제곱근/,
  },
  {
    area: 'math-sequence',
    label: '수열',
    element: '등비수열과 합',
    test: /등비수열/,
    statements: /등비수열/,
  },
  {
    area: 'math-sequence',
    label: '수열',
    element: '등차수열과 합',
    test: /등차수열/,
    statements: /등차수열/,
  },
  {
    area: 'math-sequence',
    label: '수열',
    element: '수열의 정의와 합',
    test: /수열|\\sum|Σ|∑/,
    statements: /수열|∑/,
    preferred: /∑|귀납적정의/,
  },
  {
    area: 'math-trigonometry',
    label: '삼각함수',
    element: '사인·코사인 법칙의 도형 적용',
    test: /(?:삼각형|내접|사각형).*(?:sin|cos|tan)|(?:sin|cos|tan).*삼각형|사인법칙|코사인법칙/i,
    statements: /사인법칙|코사인법칙|삼각비/,
  },
  {
    area: 'math-trigonometry',
    label: '삼각함수',
    element: '삼각함수의 값과 그래프',
    test: /sin|cos|tan|삼각함수/i,
    statements: /삼각함수|사인함수|코사인함수|삼각비/,
  },
  {
    area: 'math-trigonometry',
    label: '삼각함수',
    element: '호도법과 부채꼴',
    test: /호도법|호의길이.*부채꼴|부채꼴.*호의길이/,
    statements: /호도법|부채꼴/,
  },
  {
    area: 'math-power-log',
    label: '지수·로그',
    element: '지수·로그 함수의 그래프와 활용',
    test: /(?:log|지수함수|로그함수|\d+\^\{[^}]*[a-z])(?=[\s\S]*)[\s\S]*(?:함수|그래프|곡선)|(?:함수|그래프|곡선)[\s\S]*(?:log|\d+\^\{[^}]*[a-z])/i,
    statements: /지수함수|로그함수/,
    preferred: /그래프|활용/,
  },
  {
    area: 'math-power-log',
    label: '지수·로그',
    element: '로그의 성질과 계산',
    test: /log|로그/i,
    statements: /로그의뜻|상용로그/,
    preferred: /로그의뜻/,
  },
  {
    area: 'math-power-log',
    label: '지수·로그',
    element: '지수법칙과 지수식 계산',
    test: /지수|\d+\s*\^/,
    statements: /지수법칙|거듭제곱/,
    preferred: /지수가유리수/,
  },
  {
    area: 'math-matrix',
    label: '행렬',
    element: '행렬의 표현과 연산',
    test: /행렬/,
    statements: /행렬/,
  },
  {
    area: 'math-set',
    label: '집합·명제',
    element: '집합·명제의 관계',
    test: /집합|명제|필요조건|충분조건/,
    statements: /집합|명제|필요조건|충분조건/,
  },
  {
    area: 'math-function',
    label: '함수',
    element: '함수의 관계와 그래프',
    test: /합성함수|역함수|유리함수|무리함수/,
    statements: /함수/,
  },
  {
    area: 'math-geometry',
    label: '도형',
    element: '도형·좌표·벡터의 성질',
    test: /벡터|포물선|타원|쌍곡선|구의방정식|삼각형|원의방정식|내분점/,
    statements: /도형|벡터|포물선|타원|쌍곡선|삼각형|방정식|좌표/,
  },
  {
    area: 'math-algebra',
    label: '식과 방정식',
    element: '식·방정식·부등식',
    test: /다항식|인수분해|방정식|부등식|이차함수/,
    statements: /다항식|인수분해|방정식|부등식|이차함수/,
  },
];

export function mapAssessment(
  question: MappingQuestion,
  catalog: CatalogRecord[],
  subjectKey?: string,
): AssessmentMapping | undefined {
  const selected = subjectKey ?? question.selectedSubjectKey;
  const context = question.examSubject?.subjectKeys;
  const label = question.examSubject?.label ?? '';
  const subjects =
    (selected
      ? [selected.split('|')[1]]
      : context?.map((s) => s.split('|')[1])) ?? [];
  const family = subjects.some((s) => koreanSubjects.has(s))
    ? 'korean'
    : subjects.some((s) => mathSubjects.has(s))
      ? 'math'
      : !selected && /국어/.test(label)
        ? 'korean'
        : !selected && /수학/.test(label)
          ? 'math'
          : undefined;
  if (!family) return undefined; // Preserve existing paths for other subjects.
  const own = ownAssessmentText(question);
  const inferred =
    family === 'korean'
      ? koreanRule(own)
      : {
          rule: mathRules.find((rule) => rule.test.test(compact(own))),
          evidence: own.split('①')[0].replace(/\s+/g, ' ').slice(0, 220),
        };
  let rule = inferred.rule;
  const shared = compact(
    (question.sharedPassage?.text ?? '').replace(/<\/?[bu]>/g, ''),
  );
  if (family === 'korean' && (!rule || rule.area === 'reading')) {
    // Set-level material determines the activity, never a topical curriculum
    // code. The assessment element and quoted evidence remain per question.
    if (/모의협상/.test(shared.slice(0, 200)))
      rule = koreanRules.find((r) => r.element === '협상 전략과 대안');
    else if (
      /중략부분의줄거리|앞부분의줄거리|작자미상|시에서.*화자|시적화자/.test(
        shared,
      )
    ) {
      const expressive = /공통점|표현상|서술상|의문형어미|영탄적표현|운율/.test(
        compact(own),
      );
      rule = koreanRules.find(
        (r) =>
          r.element ===
          (expressive ? '작품의 표현과 구성' : '인물·작품의 의미와 맥락 이해'),
      );
    }
  }
  const allowedSubjects = family === 'korean' ? koreanSubjects : mathSubjects;
  // Manual course selection is an exact filter, even if it produces no match.
  const scoped = catalog.filter((row) =>
    selected
      ? key(row) === selected
      : context?.length
        ? context.includes(key(row))
        : allowedSubjects.has(row.subject),
  );
  const areas = rule
    ? scoped.filter((row) => catalogAreas(row).includes(rule.area))
    : [];
  const compatible = rule
    ? areas.filter((row) => rule.statements.test(compact(row.statement)))
    : [];
  const evidence = inferred.evidence;
  const baseReason = rule
    ? `개별 문항의 「${evidence}」를 근거로 ${rule.label}의 ‘${rule.element}’을 평가 요소로 분류했습니다.`
    : own
      ? '개별 문항에서 평가 요소를 판별할 근거가 부족합니다.'
      : '공통 지문과 구분된 개별 문항을 확인하지 못했습니다.';
  const candidates = compatible
    .map((row) => ({
      code: row.code,
      standard: row.statement,
      domain: `${row.school} · ${row.subject}`,
      subjectKey: key(row),
      rankScore: rule?.preferred?.test(compact(row.statement)) ? 2 : 1,
      reason: `${baseReason} 해당 영역과 평가 요소가 함께 나타나는 목록의 기준을 후보로 제시합니다.`,
    }))
    .sort(
      (a, b) => b.rankScore - a.rankScore || a.code.localeCompare(b.code, 'ko'),
    )
    .slice(0, 6);
  const unresolvedGlyphCount = [...question.text].filter((char) => {
    const cp = char.codePointAt(0)!;
    return (
      (cp >= 0xe000 && cp <= 0xf8ff) ||
      (cp >= 0xf0000 && cp <= 0xffffd) ||
      (cp >= 0x100000 && cp <= 0x10fffd) ||
      cp === 0xfffd
    );
  }).length;
  const hasSourceWarning =
    Boolean(question.analysisWarning || question.captureWarning) &&
    !question.captureReviewed;
  const checks = {
    catalogMembership: candidates.every((candidate) =>
      catalog.some(
        (row) =>
          row.code === candidate.code &&
          row.statement === candidate.standard &&
          key(row) === candidate.subjectKey,
      ),
    ),
    subjectScope: candidates.every((candidate) =>
      scoped.some(
        (row) =>
          key(row) === candidate.subjectKey && row.code === candidate.code,
      ),
    ),
    areaRestriction: candidates.every((candidate) =>
      areas.some(
        (row) =>
          row.code === candidate.code && key(row) === candidate.subjectKey,
      ),
    ),
    ownQuestionAvailable: Boolean(own),
    unresolvedGlyphCount,
    hasSourceWarning,
    sourceCompared: 'not-checked' as const,
  };
  return {
    version: 1,
    method: 'local-assessment-rules',
    status: !candidates.length
      ? 'unknown'
      : unresolvedGlyphCount || hasSourceWarning
        ? 'needs-source-review'
        : 'candidate',
    area: rule?.area,
    areaLabel: rule?.label,
    element: rule?.element,
    assessmentEvidence: evidence,
    reason: `${baseReason}${rule && !candidates.length ? ' 선택한 과목·영역과 평가 요소에 맞는 목록의 기준이 없어 해당 없음/판단 보류로 남깁니다.' : ' 성취기준의 최종 적합성은 검토가 필요합니다.'}`,
    candidates,
    checks,
  };
}
