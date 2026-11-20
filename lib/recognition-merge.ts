import type { AnalyzedQuestion } from './pdf-analysis';
import { questionLabel } from './question-context';

export type RecognitionUpdate = { source: AnalyzedQuestion; question: AnalyzedQuestion };
export type ReviewWorkspace = {
  questions: AnalyzedQuestion[];
  conflicts: RecognitionUpdate[];
  recognitionNotice: string;
};

function sameRegion(current: AnalyzedQuestion, source: AnalyzedQuestion) {
  return current.questionCaptures === source.questionCaptures &&
    current.sourcePageImage === source.sourcePageImage && current.type === source.type &&
    current.captureWarning === source.captureWarning && current.sharedPassage === source.sharedPassage;
}

function applyResponse(current: AnalyzedQuestion, { source, question }: RecognitionUpdate) {
  const mappingEdited = current.standardCode !== source.standardCode ||
    current.selectedSubjectKey !== source.selectedSubjectKey || current.mappingReason !== source.mappingReason ||
    current.standardCandidates !== source.standardCandidates;
  return {
    ...question,
    textEdited: question.text === current.text ? current.textEdited : false,
    answer: current.answer, answerSource: current.answerSource,
    ...(mappingEdited && {
      standardCode: current.standardCode, standard: current.standard, domain: current.domain,
      confidence: current.confidence, mappingArea: current.mappingArea, mappingReason: current.mappingReason,
      standardCandidates: current.standardCandidates, subjectCandidates: current.subjectCandidates,
      selectedSubjectKey: current.selectedSubjectKey,
    }),
  };
}

export function receiveRecognition(workspace: ReviewWorkspace, updates: RecognitionUpdate[], summary: string): ReviewWorkspace {
  const byNumber = new Map(updates.map(update => [update.source.number, update]));
  const conflicts = workspace.conflicts.filter(update => !byNumber.has(update.source.number));
  const changedRegions = new Set(byNumber.keys());
  let applied = 0, waiting = 0;
  const questions = workspace.questions.map(current => {
    const update = byNumber.get(current.number);
    if (!update || !sameRegion(current, update.source)) return current;
    changedRegions.delete(current.number);
    if (current.text !== update.source.text && current.text !== update.question.text) {
      conflicts.push(update);
      waiting++;
      return current;
    }
    applied++;
    return applyResponse(current, update);
  });
  const details = [summary, `적용 ${applied}문항`];
  if (waiting) details.push(`본문 선택 대기 ${waiting}문항`);
  if (changedRegions.size) {
    const labels = [...changedRegions].map(number => questionLabel(byNumber.get(number)!.source));
    details.push(`문항 경계 변경으로 적용 제외: ${labels.join(', ')}`);
  }
  return { questions, conflicts, recognitionNotice: details.join(' · ') };
}

export function resolveRecognition(workspace: ReviewWorkspace, conflict: RecognitionUpdate, useResponse: boolean): ReviewWorkspace {
  if (!workspace.conflicts.includes(conflict)) return workspace;
  const current = workspace.questions.find(question => question.number === conflict.source.number);
  const apply = useResponse && current && sameRegion(current, conflict.source);
  return {
    questions: apply ? workspace.questions.map(question => question === current ? applyResponse(question, conflict) : question) : workspace.questions,
    conflicts: workspace.conflicts.filter(update => update !== conflict),
    recognitionNotice: `${questionLabel(conflict.source)} · ${apply ? 'API 판독본을 적용했습니다.' : useResponse ? '문항 경계가 바뀌어 현재 편집본을 유지했습니다.' : '직접 수정본을 유지했습니다.'}`,
  };
}
