import type { AnalyzedQuestion } from './pdf-analysis';

export type BatchRecognitionProgress = {
  total: number;
  completed: number;
  current: number | null;
};
type RecognitionResult = { questions: AnalyzedQuestion[]; failures: string[]; warnings: string[] };

/** Explicit, sequential job only. Upload analysis never imports/calls this runner.
 * Stopping prevents the next request; an in-flight request may already be billed.
 * Preserve successful responses on stop/failure; never replace a failed question.
 */
export async function recognizeQuestionBatch(
  questions: readonly AnalyzedQuestion[],
  options: {
    recognize: (questions: AnalyzedQuestion[]) => Promise<RecognitionResult>;
    shouldStop: () => boolean;
    onProgress: (progress: BatchRecognitionProgress) => void;
  },
) {
  if (!questions.length || questions.length > 200) throw new Error('전체 API 판독은 1~200문항씩 실행할 수 있습니다.');
  const missing = questions.filter(question => !question.questionCaptures?.length);
  if (missing.length) throw new Error(`${missing.map(question => question.number).join(', ')}번의 문항 캡처가 없습니다. 범위를 지정한 후 전체 판독을 실행하세요.`);
  const updates: Array<{ source: AnalyzedQuestion; question: AnalyzedQuestion }> = [];
  const warnings: string[] = [], failures: string[] = [];
  let completed = 0, attempted = 0, stopped = false;
  options.onProgress({ total: questions.length, completed, current: null });
  for (const source of questions) {
    if (options.shouldStop()) { stopped = true; break; }
    options.onProgress({ total: questions.length, completed, current: source.number });
    attempted++;
    try {
      const result = await options.recognize([source]);
      if (result.failures.length) throw new Error(result.failures.join(' '));
      const question = result.questions[0];
      if (result.questions.length !== 1 || question?.number !== source.number) throw new Error('응답 문항 번호가 요청과 다릅니다.');
      updates.push({ source, question });
      warnings.push(...result.warnings);
      completed++;
    } catch (reason) {
      failures.push(`${source.number}번: ${reason instanceof Error ? reason.message : 'API 판독 실패'}`);
      // Authentication, budget, network, or malformed response may affect the
      // remaining exam too. Do not automatically repeat a failing paid call.
      break;
    }
    options.onProgress({ total: questions.length, completed, current: null });
  }
  if (completed < questions.length && options.shouldStop()) stopped = true;
  options.onProgress({ total: questions.length, completed, current: null });
  return { updates, warnings, failures, completed, attempted, total: questions.length, stopped };
}
