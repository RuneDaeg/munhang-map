import { analyzePdf, classifyQuestion, loadAchievementStandards } from './pdf-analysis';
import { countUnresolvedGlyphs } from './pdf-text';
import { validateExamQuestions } from './question-validation';

export type AnalysisProgress = { stage: 'pdf' | 'capture' | 'classify'; completed: number; total: number; percent: number; detail: string };
const dependencies = { analyzePdf, classifyQuestion, loadAchievementStandards };

// Upload analysis is local-only, regardless of saved API credentials. AI rereads
// are a separate, explicit action on selected questions in the caller.
export async function runExamAnalysis(file: File, onProgress: (progress: AnalysisProgress) => void, deps = dependencies) {
  onProgress({ stage: 'pdf', completed: 0, total: 0, percent: 0, detail: 'PDF를 여는 중' });
  const result = await deps.analyzePdf(file,
    (completed, total) => onProgress({ stage: 'pdf', completed, total, percent: Math.round(completed / Math.max(total, 1) * 70), detail: `텍스트와 원문 페이지 읽기 · ${completed}/${total}쪽` }),
    (completed, total) => onProgress({ stage: 'capture', completed, total, percent: 70 + Math.round(completed / Math.max(total, 1) * 25), detail: `문항 경계 확인·전체 캡처 · ${completed}/${total}문항` }));
  if (!result.questions.length) throw new Error('문항을 찾지 못했습니다. 텍스트가 포함된 PDF인지 확인해 주세요.');
  const questions = result.questions;
  const warnings: string[] = [result.qualityWarning];
  onProgress({ stage: 'classify', completed: 0, total: questions.length, percent: 95, detail: '성취기준 후보를 정리하는 중' });
  const catalog = await deps.loadAchievementStandards();
  const finalQuestions = validateExamQuestions(questions.map((question) => deps.classifyQuestion(question, catalog)),catalog);
  const unresolved = finalQuestions.filter(question => countUnresolvedGlyphs(question.text));
  const layoutReview = finalQuestions.filter(question => question.analysisWarning);
  if(layoutReview.length) warnings.push(`${layoutReview.length}개 문항(${layoutReview.map(q=>q.number).join(', ')}번)은 수식 배치 또는 그림형 선택지의 원본 대조가 필요합니다. 문항별 안내를 확인해 주세요.`);
  if (unresolved.length) warnings.push(`${unresolved.length}개 문항(${unresolved.map(q => q.number).join(', ')}번)에 복원하지 못한 숫자·수식 문자가 남았습니다. 원문 캡처와 대조해 주세요.`);
  const reviewCount=finalQuestions.filter(q=>q.validationFlags?.length).length;
  if(reviewCount) warnings.push(`${reviewCount}개 문항에 자동 검토 항목이 있습니다. 문항 정보에서 근거를 확인해 주세요. 자동 경고가 없어도 원문 대조는 필요합니다.`);
  onProgress({ stage: 'classify', completed: finalQuestions.length, total: finalQuestions.length, percent: 100, detail: reviewCount ? '일부 추출 결과 확인 필요' : '분석 처리 완료' });
  return { ...result, questions: finalQuestions, qualityWarning: warnings.filter(Boolean).join(' '), catalog };
}
