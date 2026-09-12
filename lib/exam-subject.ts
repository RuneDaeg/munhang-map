import type { StandardRecord } from './pdf-analysis';

export type ExamSubject = { label: string; headerText: string; subjectKeys: string[]; page: number };
const compact = (text: string) => text.normalize('NFKC').replace(/\s|[·ㆍ]/g, '').toLowerCase();

// Preserve boundaries between separate heading words. Compacting the complete
// heading made "영역 화학 I" look like "영역화학I", so the short-course guard
// rejected 화학 as though it were part of another Korean word. Still accept
// individually positioned title glyphs ("화 학") without accepting 국어 inside
// 중국어 or 과학 inside 과학탐구.
function hasSubjectTitle(headerText: string, title: string) {
  const source = headerText.normalize('NFKC').toLowerCase();
  const token = compact(title);
  const pattern = Array.from(token)
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s·ㆍ]*');
  for (const match of source.matchAll(new RegExp(pattern, 'gu'))) {
    const before = source[match.index - 1] ?? '';
    const after = source.slice(match.index + match[0].length);
    if (token.length <= 2 && (
      /[가-힣]/u.test(before) ||
      /^[가-힣]/u.test(after) && !/^영[\s·ㆍ]*역/u.test(after)
    )) continue;
    return true;
  }
  return false;
}

// Old exam titles narrow the 2022 catalogue to related courses, not equivalent
// standards. The question text still ranks candidates within those courses.
const families: Record<string, string[]> = {
  통합과학: ['통합과학1', '통합과학2'],
  통합사회: ['통합사회1', '통합사회2'],
  물리학: ['물리학', '역학과 에너지', '전자기와 양자'],
  화학: ['화학', '물질과 에너지', '화학 반응의 세계'],
  생명과학: ['생명과학', '세포와 물질대사', '생물의 유전'],
  지구과학: ['지구과학', '지구시스템과학', '행성우주과학'],
  국어: ['국어', '공통국어1', '공통국어2', '독서와 작문', '문학', '화법과 언어', '독서 토론과 글쓰기', '매체 의사소통'],
  수학: ['수학', '공통수학1', '공통수학2', '대수', '미적분Ⅰ', '미적분Ⅱ', '기하', '확률과 통계'],
  영어: ['영어', '공통영어1', '공통영어2', '영어 I', '영어 Ⅱ', '영어 독해와 작문'],
  한국사: ['한국사1', '한국사2'],
};

export function detectExamSubject(headerText: string, catalog: StandardRecord[], page: number, previous?: ExamSubject): ExamSubject | undefined {
  const header = compact(headerText);
  const school = /중학교|중[123]학년/.test(header) ? '중학교'
    : /고등학교|고[123]|학력평가|대학수학능력|수능|모의평가|과학탐구|사회탐구|통합과학|통합사회/.test(header) ? '고등학교' : undefined;
  const subjects = [...new Set(catalog.map((item) => item.subject))];
  const titles = [...new Set([...subjects, ...Object.keys(families)])].sort((a, b) => compact(b).length - compact(a).length);
  for (const title of titles) {
    if (!hasSubjectTitle(headerText, title)) continue;
    const names = families[title] ?? [title];
    const previousSchools = previous?.label === title ? new Set(previous.subjectKeys.map((key) => key.split('|')[0])) : undefined;
    const matched = catalog.filter((item) => names.includes(item.subject) && (school ? item.school === school : !previousSchools || previousSchools.has(item.school)));
    const subjectKeys = [...new Set(matched.map((item) => `${item.school}|${item.subject}`))];
    if (subjectKeys.length) return { label: title, headerText, subjectKeys, page };
  }
  return undefined;
}
