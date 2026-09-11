import type { AnalyzedQuestion } from './pdf-analysis';
import { cropPage } from './question-capture';
import { validCaptureBox } from './capture-editor';
import { normalizeQuestionText } from './math-normalization';
import { readQuestionContext } from './question-context';

const format = 'munhang-map-review';

export function serializeReview(fileName: string, questions: AnalyzedQuestion[], sourcePages: string[]) {
  return JSON.stringify({
    format, version: 1, fileName, sourcePages,
    questions: questions.map((question) => ({
      number: question.number, type: question.type, text: normalizeQuestionText(question.text),
      standardCode: question.standardCode, standard: question.standard, domain: question.domain, confidence: question.confidence,
      examSubject: question.examSubject, selectedSubjectKey: question.selectedSubjectKey,
      captureReviewed: question.captureReviewed, captureWarning: question.captureWarning, visionEnhanced: question.visionEnhanced,
      textEdited: question.textEdited, analysisWarning: question.analysisWarning,
      ...readQuestionContext(question as unknown as Record<string,unknown>),
      visualChoices: question.visualChoices?.map(({label,page,box})=>({label,page,box})),
      sourcePage: Math.max(1, sourcePages.indexOf(question.sourcePageImage ?? '') + 1),
      regions: question.questionCaptures?.map(({ page, box }) => ({ page, box })) ?? [],
    })),
  });
}

export async function parseReview(content: string) {
  const value = JSON.parse(content);
  if (value?.format !== format || value.version !== 1 || typeof value.fileName !== 'string' || !Array.isArray(value.sourcePages) || !value.sourcePages.length || value.sourcePages.length > 200 || !value.sourcePages.every((image: unknown) => typeof image === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 200) throw new Error('문항맵에서 저장한 검토 파일인지 확인해 주세요.');
  const sourcePages: string[] = value.sourcePages;
  const questions: AnalyzedQuestion[] = [];
  for (const item of value.questions) {
    if (!Number.isInteger(item?.number) || item.number < 1 || item.number > 200 || !['type', 'text', 'standardCode', 'standard', 'domain'].every((key) => typeof item[key] === 'string') || !Number.isFinite(item.confidence) || !Number.isInteger(item.sourcePage) || !sourcePages[item.sourcePage - 1] || !Array.isArray(item.regions) || !item.regions.length || item.regions.length > 40 || !item.regions.every((region: { page?: number; box?: unknown }) => Number.isInteger(region?.page) && sourcePages[(region.page ?? 0) - 1] && validCaptureBox(region.box))) throw new Error('검토 파일의 문항 또는 캡처 범위가 올바르지 않습니다.');
    const subject = item.examSubject;
    if (subject && (typeof subject.label !== 'string' || typeof subject.headerText !== 'string' || !Number.isInteger(subject.page) || !sourcePages[subject.page - 1] || !Array.isArray(subject.subjectKeys) || !subject.subjectKeys.every((key: unknown) => typeof key === 'string'))) throw new Error('검토 파일의 과목 정보가 올바르지 않습니다.');
    const captures = [];
    for (const region of item.regions) captures.push({ page: region.page, box: region.box, image: await cropPage(sourcePages[region.page - 1], region.box) });
    const visualChoices: NonNullable<AnalyzedQuestion['visualChoices']>=[];
    if(item.visualChoices!==undefined) {
      if(!Array.isArray(item.visualChoices)||item.visualChoices.length>20||!item.visualChoices.every((v: {label?:string;page?:number;box?:unknown})=>typeof v?.label==='string'&&/^[①②③④⑤]$/.test(v.label)&&Number.isInteger(v.page)&&sourcePages[(v.page??0)-1]&&validCaptureBox(v.box))) throw new Error('그림 선택지 캡처 정보가 올바르지 않습니다.');
      for(const choice of item.visualChoices) visualChoices.push({label:choice.label,page:choice.page,box:choice.box,image:await cropPage(sourcePages[choice.page-1],choice.box)});
    }
    questions.push({
      ...readQuestionContext(item,sourcePages.length),
      number: item.number, type: item.type, text: normalizeQuestionText(item.text),
      standardCode: item.standardCode, standard: item.standard, domain: item.domain, confidence: item.confidence,
      selectedSubjectKey: typeof item.selectedSubjectKey === 'string' ? item.selectedSubjectKey : undefined,
      examSubject: subject ? { label: subject.label, headerText: subject.headerText, page: subject.page, subjectKeys: subject.subjectKeys } : undefined,
      captureReviewed: item.captureReviewed === true,
      captureWarning: typeof item.captureWarning === 'string' ? item.captureWarning : undefined,
      visionEnhanced: item.visionEnhanced === true,
      textEdited: item.textEdited === true,
      analysisWarning: typeof item.analysisWarning==='string'?item.analysisWarning.slice(0,3000):undefined,
      visualChoices: visualChoices.length?visualChoices:undefined,
      sourcePageImage: sourcePages[item.sourcePage - 1], questionCaptures: captures,
    });
  }
  return { fileName: value.fileName as string, questions, sourcePages };
}

export function downloadReview(fileName: string, questions: AnalyzedQuestion[], sourcePages: string[]) {
  const url = URL.createObjectURL(new Blob([serializeReview(fileName, questions, sourcePages)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_')}_검토.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
