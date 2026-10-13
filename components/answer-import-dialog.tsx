'use client';

import { useMemo, useRef, useState } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { AnalyzedQuestion } from '@/lib/pdf-analysis';
import { previewAnswerMatches, type AnswerKeyEntry } from '@/lib/answer-key';
import { readAnswerFile } from '@/lib/answer-import';
import { questionLabel } from '@/lib/question-context';

export type AnswerUpdate = { number: number; answer: string; answerSource: string };
type Row = { entry: AnswerKeyEntry; number: string; answer: string; checked: boolean; message: string };

export function AnswerImportDialog({ questions, onApply, onClose }: {
  questions: AnalyzedQuestion[]; onApply: (updates: AnswerUpdate[]) => void; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const selected = rows.filter(row => row.checked && row.number && row.answer.trim());
  const duplicateTargets = new Set(selected.filter((row, index) => selected.findIndex(other => other.number === row.number) !== index).map(row => row.number));
  const byNumber = useMemo(() => new Map(questions.map(question => [String(question.number), question])), [questions]);

  async function read(file: File) {
    if (reading) return;
    setReading(true); setError(''); setRows([]); setWarnings([]); setPage(0); setFileName(file.name); setProgress('정답 파일 읽는 중…');
    try {
      const result = await readAnswerFile(file, setProgress);
      const matches = previewAnswerMatches(questions, result.entries);
      setWarnings(result.warnings);
      setRows(result.entries.map((entry, index) => {
        const match = matches[index];
        return { entry, number: match?.status === 'matched' ? String(match.questionNumbers[0]) : '', answer: entry.value, checked: match?.status === 'matched', message: match?.message ?? '연결할 문항을 직접 선택하세요.' };
      }));
      if (!result.entries.length) setError('명확한 문항 번호·정답 쌍을 찾지 못했습니다. 번호와 정답이 구분된 표 또는 “1: ③” 형식의 TXT/CSV를 사용하세요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '정답 파일을 읽지 못했습니다.'); }
    finally { setReading(false); setProgress(''); }
  }
  function change(index: number, patch: Partial<Row>) {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  function apply() {
    if (reading || duplicateTargets.size || !selected.length) return;
    onApply(selected.map(row => ({ number: Number(row.number), answer: row.answer.trim(), answerSource: fileName.split(/[\\/]/).pop() || '정답 파일' })));
  }
  return <Dialog open onOpenChange={open => { if (!open && !reading) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl" showCloseButton={!reading}>
      <DialogTitle>정답 파일 연결</DialogTitle>
      <DialogDescription>PDF·HWPX·UTF-8 TXT/CSV에서 정답을 읽고 원본 문항 번호와 과목으로 연결합니다. 다른 시험의 같은 번호일 수 있으니 시험명과 값을 확인한 후 반영하세요. API 호출은 하지 않습니다.</DialogDescription>
      <input ref={input} type="file" aria-label="정답 파일 선택" accept=".pdf,.hwpx,.txt,.csv" className="hidden" disabled={reading} onClick={event => { event.currentTarget.value = ''; }} onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); }} />
      <Button variant="outline" disabled={reading} onClick={() => input.current?.click()}>{reading ? <LoaderCircle className="animate-spin" /> : <Upload />}정답 파일 선택</Button>
      {fileName && <p className="break-all text-sm">정답 출처: {fileName}</p>}
      {reading && <output aria-live="polite">{progress}</output>}
      {warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-4 pl-8 text-sm text-amber-900">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows.length > 0 && <>
        <p className="text-sm">읽은 정답 {rows.length}개 · 반영 선택 {selected.length}개. 중복·모호한 항목과 기존 정답 충돌은 직접 대조해 연결하세요.</p>
        <div className="max-h-[45dvh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[570px] text-left text-sm">
            <thead className="sticky top-0 bg-muted"><tr><th className="p-2">반영</th><th className="p-2">정답표 항목</th><th className="p-2">연결할 문항</th><th className="p-2">정답</th></tr></thead>
            <tbody>{rows.slice(page * pageSize, (page + 1) * pageSize).map((row, offset) => { const index = page * pageSize + offset; return <tr key={row.entry.id} className="border-t align-top">
              <td className="p-2"><input type="checkbox" aria-label={`정답표 ${index + 1}행 반영`} checked={row.checked} disabled={reading || !row.number || !row.answer.trim()} onChange={event => change(index, { checked: event.target.checked })} /></td>
              <td className="max-w-56 p-2"><p>{[row.entry.sourceItemId, row.entry.subject, row.entry.sectionLabel, row.entry.number !== undefined ? `${row.entry.number}번` : ''].filter(Boolean).join(' · ')}</p><p className="mt-1 text-xs text-muted-foreground">{row.entry.sourcePage ? `${row.entry.sourcePage}쪽 · ` : ''}{row.message}</p></td>
              <td className="p-2"><NativeSelect aria-label={`정답표 ${index + 1}행 연결 문항`} value={row.number} disabled={reading} onChange={event => change(index, { number: event.target.value, checked: Boolean(event.target.value) })}>
                <NativeSelectOption value="">연결 안 함</NativeSelectOption>
                {questions.map(question => <NativeSelectOption key={question.number} value={String(question.number)}>{questionLabel(question)} · {question.examSubject?.label || question.domain || '교과 미확정'}</NativeSelectOption>)}
              </NativeSelect>{row.number && byNumber.get(row.number)?.answer && <p className="mt-1 break-words text-xs text-amber-900">기존 정답: {byNumber.get(row.number)?.answer} → 선택한 새 값으로 변경</p>}</td>
              <td className="p-2"><input aria-label={`정답표 ${index + 1}행 정답`} value={row.answer} maxLength={500} disabled={reading} onChange={event => change(index, { answer: event.target.value })} className="w-28 rounded border bg-background px-2 py-1.5" /></td>
            </tr>; })}</tbody>
          </table>
        </div>
        <nav aria-label="정답 검토 페이지" className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!page || reading} onClick={() => setPage(value => value - 1)}>이전</Button><span className="text-sm">{page + 1} / {Math.ceil(rows.length / pageSize)}쪽 · 선택은 모든 쪽에 적용</span><Button variant="outline" disabled={(page + 1) * pageSize >= rows.length || reading} onClick={() => setPage(value => value + 1)}>다음</Button></nav>
        {duplicateTargets.size > 0 && <p role="alert" className="text-sm text-destructive">같은 문항에 여러 정답이 선택되어 있습니다. 문항마다 한 항목만 선택하세요.</p>}
      </>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={reading} onClick={onClose}>취소</Button><Button disabled={reading || !selected.length || duplicateTargets.size > 0} onClick={apply}>확인한 정답 {selected.length}개 반영</Button></div>
      <p className="text-xs text-muted-foreground">정답은 본문과 분리해 저장됩니다. 문서 내보내기의 ‘정답 포함 (교사용)’은 기본으로 꺼져 있습니다. 이미지형 정답표·복잡한 표 배치는 수동 확인이 필요합니다.</p>
    </DialogContent>
  </Dialog>;
}
