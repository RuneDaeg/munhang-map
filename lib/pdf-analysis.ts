import { layoutPage, locateQuestions, type PageLayout, type PageText } from './pdf-layout';
import { detectExamSubject, type ExamSubject } from './exam-subject';
import { cropPage, type QuestionCapture } from './question-capture';
import type { PDFPageProxy } from 'pdfjs-dist';

export type StandardCandidate = {
  code: string;
  standard: string;
  domain: string;
  confidence: number;
};

export type SubjectCandidate = {
  key: string;
  label: string;
  confidence: number;
};

export type AnalyzedQuestion = {
  number: number;
  type: string;
  text: string;
  standardCode: string;
  standard: string;
  confidence: number;
  domain: string;
  standardCandidates?: StandardCandidate[];
  subjectCandidates?: SubjectCandidate[];
  sourcePageImage?: string;
  figureImage?: string;
  visionEnhanced?: boolean;
  questionCaptures?: QuestionCapture[];
  captureWarning?: string;
  examSubject?: ExamSubject;
  selectedSubjectKey?: string;
};

// The curriculum catalogue is the pinned worksheet-grab dataset documented in
// THIRD_PARTY_NOTICES.md; the app never invents or rewrites standard statements.
export type StandardRecord = {
  school: string;
  subject: string;
  grade: string;
  code: string;
  statement: string;
};

type QuestionChunk = { number: number; page: number; text: string };
type ScoredStandard = { standard: StandardRecord; score: number };
let standardsPromise: Promise<StandardRecord[]> | undefined;
const standardTokenCache = new WeakMap<StandardRecord, Set<string>>();

const stopWords = new Set([
  '그리고', '그러나', '통하여', '활용하여', '이해하고', '설명할', '분석할', '있다',
  '대한', '따라', '다양한', '과정', '관계', '경우', '것은', '것을', '있는', '한다',
  '다음', '그림', '보기', '옳은', '고른', '내용', '학생', '교사', '문항',
]);

export function loadAchievementStandards() {
  standardsPromise ??= fetch('/data/achievement-standards.csv')
    .then((response) => {
      if (!response.ok) throw new Error('성취기준 원본 데이터를 불러오지 못했습니다.');
      return response.text();
    })
    .then(parseStandardsCsv);
  return standardsPromise;
}

export async function analyzePdf(file: File, onProgress?: (page: number, total: number) => void) {
  const [pdfjs, allStandards] = await Promise.all([import('pdfjs-dist'), loadAchievementStandards()]);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const source = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: source }).promise;
  const pages: PageLayout[] = [];
  const pageImages: string[] = [];
  try {
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const [content, pageImage] = await Promise.all([page.getTextContent(), renderPageCapture(page)]);
    const positioned: PageText[] = content.items
      .filter((item): item is typeof item & { str: string; transform: number[]; width?: number } => 'str' in item && 'transform' in item && Boolean(item.str.trim()))
      .map((item) => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.hypot(transform[2], transform[3]);
        return { text: item.str.trim(), x: transform[4], y: transform[5] - height, width: typeof item.width === 'number' ? item.width : 0, height };
      });
    pages.push(layoutPage(positioned, viewport.width, viewport.height, pageNumber));
    pageImages.push(pageImage);
    page.cleanup();
    onProgress?.(pageNumber, pdf.numPages);
  }

  const extractedText = pages.flatMap((page) => page.columns.flatMap((column) => column.lines.map((line) => line.text))).join('');
  if (extractedText.length < 40) {
    throw new Error('이 PDF는 스캔 이미지로 구성되어 텍스트를 읽을 수 없습니다. OCR 기능이 필요한 문서입니다.');
  }
  const brokenGlyphCount = (extractedText.match(/[�▤▥▦▧▨▩▒▓■]{1}/g) ?? []).length;
  const qualityWarning = brokenGlyphCount / extractedText.length > 0.008
    ? 'PDF 글꼴 또는 그림 일부가 깨진 문자로 추출되었습니다. 후보를 확정하기 전에 문항 텍스트를 확인하거나 OCR 처리된 PDF를 사용해 주세요.'
    : '';

  const chunks = locateQuestions(pages);
  const subjects = new Map<number, ExamSubject>();
  let previousSubject: ExamSubject | undefined;
  for (const page of pages) {
    previousSubject = detectExamSubject(page.headerText, allStandards, page.page, previousSubject) ?? previousSubject;
    if (previousSubject) subjects.set(page.page, previousSubject);
  }
  const questions: AnalyzedQuestion[] = [];
  for (const chunk of chunks.slice(0, 80)) {
    const questionCaptures: QuestionCapture[] = [];
    for (const region of chunk.regions) questionCaptures.push({ ...region, image: await cropPage(pageImages[region.page - 1], region.box) });
    questions.push(classifyQuestion({
      number: chunk.number,
      type: `자동 추출 문항 · ${chunk.page}쪽`,
      text: chunk.text,
      standardCode: '', standard: '', confidence: 0, domain: '',
      sourcePageImage: pageImages[chunk.page - 1],
      questionCaptures,
      captureWarning: chunk.warning,
      examSubject: subjects.get(chunk.page),
    }, allStandards));
  }
  return {
    pageCount: pdf.numPages,
    qualityWarning,
    questions,
  };
  } finally { await pdf.destroy(); }
}

async function renderPageCapture(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return '';
  await page.render({ canvasContext: context, viewport }).promise;
  const image = canvas.toDataURL('image/jpeg', 0.9);
  canvas.width = 1;
  canvas.height = 1;
  return image;
}

export function classifyQuestion(question: AnalyzedQuestion, catalog: StandardRecord[], subjectKey?: string): AnalyzedQuestion {
  const selectedSubjectKey = subjectKey ?? question.selectedSubjectKey;
  const contextKeys = question.examSubject?.subjectKeys;
  const scopedCatalog = contextKeys?.length ? catalog.filter((item) => contextKeys.includes(`${item.school}|${item.subject}`) || `${item.school}|${item.subject}` === selectedSubjectKey) : catalog;
  const rankedAll = scoreStandards(question.text, scopedCatalog.length ? scopedCatalog : catalog);
  const subjectScores = new Map<string, { label: string; score: number }>();
  for (const item of rankedAll) {
    const key = `${item.standard.school}|${item.standard.subject}`;
    const previous = subjectScores.get(key);
    if (!previous || item.score > previous.score) subjectScores.set(key, { label: `${item.standard.school} · ${item.standard.subject}`, score: item.score });
  }
  const subjectCandidates = [...subjectScores.entries()]
    .sort((a, b) => a[0] === selectedSubjectKey ? -1 : b[0] === selectedSubjectKey ? 1 : b[1].score - a[1].score)
    .slice(0, 6)
    .map(([key, value]) => ({ key, label: value.label, confidence: scoreToConfidence(value.score) }));
  const chosenSubject = selectedSubjectKey ?? subjectCandidates[0]?.key;
  const scoped = chosenSubject ? rankedAll.filter(({ standard }) => `${standard.school}|${standard.subject}` === chosenSubject) : rankedAll;
  const standardCandidates = scoped.slice(0, 6).map(({ standard, score }) => ({
    code: standard.code,
    standard: standard.statement,
    domain: `${standard.school} · ${standard.subject}`,
    confidence: scoreToConfidence(score),
  }));
  const best = standardCandidates[0];
  if (!best) return question;
  return { ...question, selectedSubjectKey, standardCode: best.code, standard: best.standard, confidence: best.confidence, domain: best.domain, standardCandidates, subjectCandidates };
}

export function splitIntoQuestions(pages: string[][]): QuestionChunk[] {
  const rows = pages.flatMap((lines, pageIndex) => lines.flatMap((text) => splitInlineQuestionStarts(text).map((part) => ({ text: part, page: pageIndex + 1 }))));
  const candidates = rows.map((row, index) => {
    const match = row.text.match(/^\s*(?:문항\s*)?(\d{1,2})\s*[.)]\s*(.{6,})$/);
    return match ? { index, number: Number(match[1]), page: row.page, rest: match[2].trim() } : null;
  }).filter((value): value is NonNullable<typeof value> => Boolean(value && value.number >= 1 && value.number <= 80));

  const sequence = longestAscendingSequence(candidates);
  if (sequence.length >= 2) {
    return sequence.map((candidate, index) => {
      const nextIndex = sequence[index + 1]?.index ?? rows.length;
      const body = [candidate.rest, ...rows.slice(candidate.index + 1, nextIndex).map((row) => row.text)].join('\n').trim();
      return { number: candidate.number, page: candidate.page, text: body };
    }).filter((chunk) => chunk.text.length > 8);
  }

  return pages.map((lines, pageIndex) => ({ number: pageIndex + 1, page: pageIndex + 1, text: lines.join('\n').trim() })).filter((chunk) => chunk.text.length > 8);
}

function splitInlineQuestionStarts(text: string) {
  return text
    .replace(/\s+(\d{1,2}\s*[.)]\s*(?=(?:다음|그림|표|교사|학생|어느|다음은|다음과)))/g, '\n$1')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

function longestAscendingSequence<T extends { number: number }>(items: T[]) {
  if (!items.length) return [] as T[];
  const lengths = items.map(() => 1);
  const previous = items.map(() => -1);
  for (let current = 0; current < items.length; current += 1) {
    for (let candidate = 0; candidate < current; candidate += 1) {
      const gap = items[current].number - items[candidate].number;
      if (gap > 0 && gap <= 12 && lengths[candidate] + 1 > lengths[current]) {
        lengths[current] = lengths[candidate] + 1;
        previous[current] = candidate;
      }
    }
  }
  let cursor = lengths.indexOf(Math.max(...lengths));
  const result: T[] = [];
  while (cursor >= 0) { result.unshift(items[cursor]); cursor = previous[cursor]; }
  return result;
}

function scoreStandards(text: string, catalog: StandardRecord[]): ScoredStandard[] {
  const questionTokens = tokenize(text);
  return catalog.map((standard) => {
    let standardTokens = standardTokenCache.get(standard);
    if (!standardTokens) {
      standardTokens = tokenize(standard.statement);
      standardTokenCache.set(standard, standardTokens);
    }
    const shared = [...questionTokens].filter((token) => standardTokens.has(token));
    const phraseBonus = shared.reduce((sum, token) => sum + Math.min(token.length, 6), 0);
    return { standard, score: shared.length * 5 + phraseBonus };
  }).sort((a, b) => b.score - a.score);
}

function scoreToConfidence(score: number) {
  return score === 0 ? 35 : Math.min(96, 48 + score * 2);
}

function tokenize(text: string) {
  return new Set((text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [])
    .map((token) => token.replace(/(으로|에서|에게|하고|하는|하여|한다|된다|있음을|있다|대한|따른|에게|처럼|보다|까지|부터|과|와|의|을|를|이|가|은|는|에|로)$/u, ''))
    .filter((token) => token.length >= 2 && !stopWords.has(token)));
}

export function parseStandardsCsv(csv: string): StandardRecord[] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.slice(1).map((values) => ({
    school: values[0]?.replace(/^\uFEFF/, '').trim(),
    subject: values[1]?.trim(),
    grade: values[2]?.trim(),
    code: values[3]?.trim(),
    statement: values[4]?.trim(),
  })).filter((record) => record.school && record.subject && record.code && record.statement);
}
