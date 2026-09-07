import { analyzePdf, classifyQuestion, loadAchievementStandards } from './pdf-analysis';
import { enhanceQuestionsWithVision, getVisionStatus } from './vision-recognition';

export type AnalysisProgress = { stage: 'pdf' | 'capture' | 'vision' | 'classify'; completed: number; total: number; percent: number; detail: string };
const dependencies = { analyzePdf, classifyQuestion, loadAchievementStandards, enhanceQuestionsWithVision, getVisionStatus };

// The caller receives question data only after all configured stages settle.
export async function runExamAnalysis(file: File, onProgress: (progress: AnalysisProgress) => void, deps = dependencies) {
  onProgress({ stage: 'pdf', completed: 0, total: 0, percent: 0, detail: 'PDF를 여는 중' });
  const result = await deps.analyzePdf(file,
    (completed, total) => onProgress({ stage: 'pdf', completed, total, percent: Math.round(completed / total * 50), detail: `텍스트와 원문 페이지 읽기 · ${completed}/${total}쪽` }),
    (completed, total) => onProgress({ stage: 'capture', completed, total, percent: 50 + Math.round(completed / Math.max(total, 1) * 15), detail: `문항 경계 확인·전체 캡처 · ${completed}/${total}문항` }));
  if (!result.questions.length) throw new Error('문항을 찾지 못했습니다. 텍스트가 포함된 PDF인지 확인해 주세요.');
  onProgress({ stage: 'vision', completed: 0, total: result.questions.length, percent: 65, detail: '자동 판독 API 연결을 확인하는 중' });
  const vision = await deps.getVisionStatus();
  let questions = result.questions;
  const warnings = [result.qualityWarning];
  let failures: string[] = [];
  if (vision.available) {
    const progress = (completed: number, total: number) => onProgress({ stage: 'vision', completed, total, percent: 65 + Math.round(completed / total * 30), detail: completed < total ? `${questions[completed].number}번 발문·수식 판독 중 · ${completed}/${total}문항 완료` : `발문·수식 판독 처리 완료 · ${total}/${total}문항` });
    progress(0, questions.length);
    const enhanced = await deps.enhanceQuestionsWithVision(questions, progress);
    questions = enhanced.questions;
    failures = enhanced.failures;
    if (failures.length) warnings.push(`${failures.length}개 문항은 자동 판독을 완료하지 못했습니다. 원문 캡처와 기본 추출문을 보존했습니다. 해당 문항을 확인하고 다시 판독해 주세요.`);
  } else {
    warnings.push('API 연결이 없어 AI 발문·수식 판독은 건너뛰었습니다. 기본 텍스트와 문항 전체 캡처를 확인해 주세요.');
  }
  onProgress({ stage: 'classify', completed: 0, total: questions.length, percent: 95, detail: '성취기준 후보를 정리하는 중' });
  const catalog = await deps.loadAchievementStandards();
  const finalQuestions = questions.map((question) => deps.classifyQuestion(question, catalog));
  onProgress({ stage: 'classify', completed: finalQuestions.length, total: finalQuestions.length, percent: 100, detail: failures.length ? '일부 판독 결과 확인 필요' : '분석 처리 완료' });
  return { ...result, questions: finalQuestions, qualityWarning: warnings.filter(Boolean).join(' '), failures, vision, catalog };
}
