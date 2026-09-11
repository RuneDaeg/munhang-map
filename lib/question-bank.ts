import type { AnalyzedQuestion } from './pdf-analysis';
import { normalizeQuestionText } from './math-normalization';
import { readQuestionContext } from './question-context';

export type BankItem = { id: string; sourceFileName: string; savedAt: string; number: number; standardCode: string; domain: string; text: string; confidence: number };

async function bankRequest<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/question-bank${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('내 문제함은 새 로컬 실행본에서 사용할 수 있습니다. 문항맵.command 또는 문항맵.bat로 실행해 주세요.');
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || '문제함 요청을 처리하지 못했습니다.');
  return result as T;
}

export async function listBankItems(): Promise<BankItem[]> {
  const result = await bankRequest<{ items: BankItem[] }>();
  if (!Array.isArray(result.items)) throw new Error('문제함 목록을 읽지 못했습니다.');
  return result.items.map((item) => ({ ...item, text: normalizeQuestionText(item.text) }));
}

export async function saveToQuestionBank(sourceFileName: string, questions: AnalyzedQuestion[], sourcePages: string[]): Promise<{ saved: number; updated: boolean }> {
  if (!sourcePages.length || !questions.length) throw new Error('PDF 분석을 완료한 후 저장해 주세요.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourcePages.join('')));
  const sourceFingerprint = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  // Whitelist the document content. Never send API settings or full source pages.
  const snapshots = questions.map((question) => ({ number: question.number, type: question.type, text: normalizeQuestionText(question.text), standardCode: question.standardCode, standard: question.standard, domain: question.domain, confidence: question.confidence, questionCaptures: question.questionCaptures?.map(({ page, box, image }) => ({ page, box, image })), captureWarning: question.captureWarning, captureReviewed: question.captureReviewed, visionEnhanced: question.visionEnhanced, textEdited: question.textEdited, analysisWarning: question.analysisWarning, visualChoices: question.visualChoices?.map(({label,page,box,image})=>({label,page,box,image})) }));
  return bankRequest<{ saved: number; updated: boolean }>('', { sourceFileName, sourceFingerprint,
    questions: snapshots.map((snapshot,index)=>({...snapshot,...readQuestionContext(questions[index] as unknown as Record<string,unknown>)})) });
}

export async function loadBankSelection(ids: string[]): Promise<AnalyzedQuestion[]> {
  const result = await bankRequest<{ questions: AnalyzedQuestion[] }>('/selection', { ids });
  if (!Array.isArray(result.questions) || result.questions.length !== ids.length) throw new Error('선택한 문항을 불러오지 못했습니다.');
  return result.questions.map((question) => ({ ...question, text: normalizeQuestionText(question.text) }));
}
