import { layoutPage, locateQuestions, type PageLayout, type PageText } from './pdf-layout';
import { detectExamSubject, type ExamSubject } from './exam-subject';
import { cropPage, type QuestionCapture } from './question-capture';
import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfRules, structureQuestionRegion, type Rule } from './pdf-structures';
import { countUnresolvedGlyphs, extractPositionedText } from './pdf-text';
import { pdfImageAreas, locateVisualChoices, type PdfImageArea } from './pdf-visual-choices';
import type { ValidationFlag } from './question-validation';
import { mapAssessment } from './assessment-mapping';
import { imageTextStructures } from './pdf-raster-structures';
import type { PdfStructure } from './pdf-structures';
import { normalizeQuestionText } from './math-normalization';
import { scienceAssessmentScope } from './science-assessment';

export type StandardCandidate = {
  code: string;
  standard: string;
  domain: string;
  confidence: number;
  reason?: string;
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
  visualChoices?: Array<QuestionCapture & {label:string}>;
  analysisWarning?: string;
  textEdited?: boolean;
  captureWarning?: string;
  captureReviewed?: boolean;
  examSubject?: ExamSubject;
  selectedSubjectKey?: string;
  sourceFileName?: string;
  assessmentText?: string;
  sharedPassage?: {range:[number,number];text:string;pages:number[]};
  mappingArea?: string;
  mappingReason?: string;
  validationFlags?: ValidationFlag[];
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

export async function analyzePdf(file: File, onProgress?: (page: number, total: number) => void, onCaptureProgress?: (completed: number, total: number) => void) {
  const [pdfjs, allStandards] = await Promise.all([import('pdfjs-dist'), loadAchievementStandards()]);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const source = new Uint8Array(await file.arrayBuffer());
  // Retain embedded glyph data for outline verification; never persist it.
  // PDF.js otherwise releases font.data immediately after binding the font.
  const pdf = await pdfjs.getDocument({ data: source, fontExtraProperties: true }).promise;
  const pages: PageLayout[] = [];
  const geometry: Array<{ items: PageText[]; rules: Rule[]; images:PdfImageArea[]; rasterStructures:PdfStructure[]; mathWarnings:Array<{x:number;y:number}> }> = [];
  const pageImages: string[] = [];
  try {
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const [content, pageImage, operators] = await Promise.all([page.getTextContent(), renderPageCapture(page), page.getOperatorList()]);
    const rules = pdfRules(operators, pdfjs.OPS, viewport.transform);
    const { items: positioned, mathWarnings } = extractPositionedText(content.items, viewport.transform, operators, pdfjs.OPS, (id) => page.commonObjs.get(id), rules);
    const layout=layoutPage(positioned, viewport.width, viewport.height, pageNumber);
    pages.push(layout);
    const images=pdfImageAreas(operators,pdfjs.OPS,viewport.transform);
    const rasterStructures=await imageTextStructures(pageImage,viewport.width,viewport.height,images,layout.bodyItems);
    geometry.push({items:layout.bodyItems,rules,images,rasterStructures,mathWarnings});
    pageImages.push(pageImage);
    page.cleanup();
    onProgress?.(pageNumber, pdf.numPages);
  }

  const extractedText = pages.flatMap((page) => page.columns.flatMap((column) => column.lines.map((line) => line.text))).join('');
  if (extractedText.length < 40) {
    throw new Error('이 PDF는 스캔 이미지로 구성되어 텍스트를 읽을 수 없습니다. OCR 기능이 필요한 문서입니다.');
  }
  const brokenGlyphCount = countUnresolvedGlyphs(extractedText);
  const qualityWarning = brokenGlyphCount
    ? `PDF 기본 추출에서 ${brokenGlyphCount}개 문자를 복원하지 못했습니다. 원문 캡처와 대조가 필요합니다.`
    : '';

  const chunks = locateQuestions(pages);
  const subjects = new Map<number, ExamSubject>();
  let previousSubject: ExamSubject | undefined;
  for (const page of pages) {
    previousSubject = detectExamSubject(page.headerText, allStandards, page.page, previousSubject) ?? previousSubject;
    if (previousSubject) subjects.set(page.page, previousSubject);
  }
  const questions: AnalyzedQuestion[] = [];
  onCaptureProgress?.(0, Math.min(chunks.length, 80));
  for (const chunk of chunks.slice(0, 80)) {
    const questionCaptures: QuestionCapture[] = [];
    const visualChoices: NonNullable<AnalyzedQuestion['visualChoices']> = [];
    const warnings: string[] = [];
    for (const region of chunk.regions) questionCaptures.push({ ...region, image: await cropPage(pageImages[region.page - 1], region.box) });
    for (const region of chunk.regions) {
      const source=geometry[region.page-1],page=pages[region.page-1];
      for(const choice of locateVisualChoices(source.items,source.images,region.box,page.width,page.height))
        visualChoices.push({...choice,page:region.page,image:await cropPage(pageImages[region.page-1],choice.box)});
      if(source.mathWarnings.some(i=>i.x>=region.box[0]*page.width && i.x<(region.box[0]+region.box[2])*page.width && i.y>=region.box[1]*page.height && i.y<(region.box[1]+region.box[3])*page.height))
        warnings.push('분수·루트의 일부 배치를 확정하지 못했습니다. 원문과 대조해 주세요.');
    }
    if(visualChoices.length) warnings.push('그림형 선택지는 셀 배치와 빗금을 원본 이미지로 보존했습니다. 아래 선택지 캡처를 기준으로 확인하세요.');
    const structuredRegions = chunk.regions.map(region => {
      const source = geometry[region.page-1], page = pages[region.page-1];
      return structureQuestionRegion(source.items,source.rules,region.box,page.width,page.height,source.rasterStructures,source.images);
    });
    const structuredText = normalizeQuestionText(structuredRegions.map(region=>region.text).join('\n').replace(new RegExp(`^\\s*${chunk.number}\\s*[.)]\\s*`),'') || chunk.text);
    const assessmentText = normalizeQuestionText(structuredRegions.slice(chunk.sharedRegionCount ?? 0).map(region=>region.text).join('\n')
      .replace(new RegExp(`^\\s*${chunk.number}\\s*[.)]\\s*`),''));
    questions.push(classifyQuestion({
      number: chunk.number,
      type: `자동 추출 문항 · ${chunk.page}쪽`,
      text: structuredText,
      assessmentText,
      sharedPassage: chunk.sharedPassage ? {...chunk.sharedPassage,
        text:normalizeQuestionText(structuredRegions.slice(0,chunk.sharedRegionCount).map(region=>region.text).join('\n'))} : undefined,
      standardCode: '', standard: '', confidence: 0, domain: '',
      sourcePageImage: pageImages[chunk.page - 1],
      questionCaptures,
      visualChoices: visualChoices.length ? visualChoices : undefined,
      analysisWarning: [...new Set(warnings)].join(' ') || undefined,
      captureWarning: chunk.warning,
      examSubject: subjects.get(chunk.page),
    }, allStandards));
    onCaptureProgress?.(questions.length, Math.min(chunks.length, 80));
  }
  return {
    pageCount: pdf.numPages,
    qualityWarning,
    questions,
    sourcePages: pageImages,
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
  const assessment = mapAssessment(question,catalog,subjectKey);
  if(assessment) {
    const standardCandidates=assessment.candidates.map(c=>({code:c.code,standard:c.standard,domain:c.domain,reason:c.reason,confidence:0}));
    const subjectCandidates=[...new Map(assessment.candidates.map(c=>[c.subjectKey,{key:c.subjectKey,label:c.domain,confidence:0}])).values()];
    const best=standardCandidates[0];
    return {...question,selectedSubjectKey:subjectKey ?? question.selectedSubjectKey,
      standardCode:best?.code ?? '',standard:best?.standard ?? '해당 없음 · 평가 요소와 교과를 확인해 주세요.',
      domain:best?.domain ?? question.examSubject?.label ?? question.domain,confidence:0,
      standardCandidates,subjectCandidates,mappingArea:assessment.areaLabel,mappingReason:assessment.reason};
  }
  const selectedSubjectKey = subjectKey ?? question.selectedSubjectKey;
  const contextKeys = question.examSubject?.subjectKeys;
  const scopedCatalog = contextKeys?.length ? catalog.filter((item) => contextKeys.includes(`${item.school}|${item.subject}`) || `${item.school}|${item.subject}` === selectedSubjectKey) : catalog;
  const scienceScope = scienceAssessmentScope(question, scopedCatalog, selectedSubjectKey);
  const rankedAll = scoreStandards(question.text, scienceScope?.catalog ?? (scopedCatalog.length ? scopedCatalog : catalog));
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
    ...(scienceScope ? { reason: scienceScope.reason } : {}),
  }));
  const best = standardCandidates[0];
  return { ...question, selectedSubjectKey, standardCode: best?.code ?? '', standard: best?.standard ?? '해당 없음 · 교과를 확인해 주세요.', confidence: scienceScope ? 0 : best?.confidence ?? 0, domain: best?.domain ?? question.examSubject?.label ?? '', standardCandidates, subjectCandidates, mappingArea:scienceScope?.area, mappingReason:scienceScope ? scienceScope.reason + (!best ? ' 선택한 과목의 목록에 맞는 기준이 없어 판단을 보류합니다.' : '') : undefined, validationFlags:undefined };
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
