'use client';

import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LoaderCircle, Pencil, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ExportDialog } from '@/components/export-dialog';
import { listBankItems, loadBankItem, loadBankSelection, updateBankItem, type BankEntry, type BankItem } from '@/lib/question-bank';
import type { AnalyzedQuestion } from '@/lib/pdf-analysis';
import { questionStorageProblem } from '@/lib/question-storage-check';
import QuestionTextEditor from './question-text-editor';
const MathText = lazy(() => import('./math-text'));

export function QuestionBank({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<AnalyzedQuestion | null>(null);
  const [exportQuestions, setExportQuestions] = useState<AnalyzedQuestion[] | null>(null);
  const [editing, setEditing] = useState<BankEntry | null>(null);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  const dirty = Boolean(editing && editing.question.text !== draft);
  const previewDraft = useDeferredValue(draft);
  useEffect(() => {
    if (!dirty) return;
    const preventExit = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    void listBankItems().then((rows) => { if (active) setItems(rows); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '문제함을 읽지 못했습니다.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const sources = useMemo(() => [...new Set(items.map((item) => item.sourceFileName))], [items]);
  const visible = useMemo(() => items.filter((item) => (!source || item.sourceFileName === source) && `${item.sourceFileName} ${item.standardCode} ${item.domain} ${item.text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [items, source, query]);
  const checked = new Set(selected);
  function discardDraft() {
    return !dirty || window.confirm('저장하지 않은 수정 내용을 버릴까요? 기존 문제함 문항은 바뀌지 않습니다.');
  }
  async function retrieve(ids: string[], exportMode: boolean) {
    if (operation.current || (!exportMode && !discardDraft())) return;
    operation.current = true;
    setWorking(true); setError('');
    try {
      const questions = await loadBankSelection(ids);
      if (exportMode) setExportQuestions(questions); else { setPreview(questions[0]); setEditing(null); setNotice(''); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '문항을 불러오지 못했습니다.'); }
    finally { operation.current = false; setWorking(false); }
  }
  async function beginEdit(id: string) {
    if (operation.current || !discardDraft()) return;
    operation.current = true; setWorking(true); setError(''); setNotice('');
    try {
      const entry = await loadBankItem(id);
      setEditing(entry); setPreview(entry.question); setDraft(entry.question.text);
      setEditError(questionStorageProblem(entry.question.text) || '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '문항을 불러오지 못했습니다.'); }
    finally { operation.current = false; setWorking(false); }
  }
  async function saveEdit() {
    if (!editing || operation.current) return;
    operation.current = true; setWorking(true); setEditError(''); setNotice('');
    try {
      const updated = await updateBankItem(editing, draft);
      setEditing(updated); setPreview(updated.question); setDraft(updated.question.text);
      setItems(current => current.map(item => item.id === updated.id ? { ...item, text: updated.question.text.slice(0, 500), savedAt: updated.savedAt || item.savedAt } : item)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.sourceFileName.localeCompare(b.sourceFileName, 'ko') || a.number - b.number));
      setNotice('이 문항을 저장했습니다. 캡처·성취기준·같은 PDF의 다른 문항은 유지했습니다.');
    } catch (reason) { setEditError(reason instanceof Error ? reason.message : '저장하지 못했습니다. 초안은 유지됩니다.'); }
    finally { operation.current = false; setWorking(false); }
  }
  function checkDraft() {
    const problem = questionStorageProblem(draft);
    setEditError(problem || '');
    setNotice(problem ? '' : '화면·DOCX·HWPX 수식 변환 검사 통과. 수식의 의미나 정답을 보증하는 검사는 아닙니다.');
  }
  function selectVisible() {
    const next = [...new Set([...selected, ...visible.map((item) => item.id)])];
    if (next.length > 200) { setError('한 번에 200문항까지 선택할 수 있습니다. PDF 또는 성취기준으로 좁혀 주세요.'); return; }
    setSelected(next);
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !working && !exportQuestions && discardDraft()) onClose(); }}>
      <DialogContent className="flex h-[90vh] flex-col sm:max-w-5xl" showCloseButton={!working && !exportQuestions}>
        <DialogTitle>내 문제함</DialogTitle>
        <DialogDescription>이 컴퓨터에 저장한 {items.length}문항. 문항을 수정하거나 여러 PDF에서 골라 함께 내보낼 수 있습니다. 캡처·성취기준은 유지하며 API를 호출하지 않습니다.</DialogDescription>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="문제함 검색" placeholder="성취기준 코드, 교과, 문항 텍스트 검색" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" /></div>
          <NativeSelect aria-label="원본 PDF 필터" value={source} onChange={(event) => setSource(event.target.value)} className="sm:max-w-xs"><NativeSelectOption value="">모든 PDF</NativeSelectOption>{sources.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><Button variant="outline" size="sm" disabled={working || !visible.length} onClick={selectVisible}>검색 결과 모두 선택</Button><Button variant="ghost" size="sm" disabled={working || !selected.length} onClick={() => setSelected([])}>선택 해제</Button><span>{visible.length}문항 표시 · {selected.length}문항 선택</span></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className={`grid min-h-0 flex-1 gap-4 overflow-auto ${editing ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]' : 'lg:grid-cols-[minmax(0,1fr)_300px]'}`}>
          <div className="min-w-0 space-y-2">
            {loading && <output className="flex items-center gap-2 p-6"><LoaderCircle className="size-4 animate-spin" />문제함을 불러오는 중…</output>}
            {!loading && !visible.length && <p className="rounded-xl border p-6 text-sm leading-6 text-muted-foreground">{items.length ? '검색 조건에 맞는 문항이 없습니다.' : '저장한 문항이 없습니다. PDF 분석 후 ‘문제함에 저장’을 눌러 주세요.'}</p>}
            {visible.map((item) => <article key={item.id} className={`rounded-xl border p-3 ${checked.has(item.id) ? 'border-primary bg-primary/5' : ''}`}>
              <div className="flex items-start gap-3"><Checkbox aria-label={`${item.sourceFileName} ${item.number}번 선택`} className="mt-1" disabled={working} checked={checked.has(item.id)} onCheckedChange={(value) => {
                if (value && selected.length >= 200) { setError('한 번에 200문항까지 선택할 수 있습니다.'); return; }
                setSelected((current) => value ? [...current, item.id] : current.filter((id) => id !== item.id));
              }} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.sourceFileName} · {item.number}번</p><p className="mt-1 text-sm text-primary">{item.standardCode || '미분류'} · {item.domain}</p><p className="mt-2 line-clamp-2 text-sm leading-6">{item.text}</p><div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={working} onClick={() => void retrieve([item.id], false)}>원문 캡처 보기</Button><Button variant="outline" size="sm" disabled={working} onClick={() => void beginEdit(item.id)} aria-label={`${item.sourceFileName} ${item.number}번 수정`}><Pencil />문항 수정</Button></div></div></div>
            </article>)}
          </div>
          <aside className="min-w-0 rounded-xl border bg-muted/30 p-3">
            {editing && <section className="mb-4 space-y-3" aria-label="문제함 문항 편집">
              <h3 className="break-words font-semibold">{editing.question.sourceFileName} · {editing.question.number}번 수정</h3>
              <p className="text-sm leading-6 text-muted-foreground">수식은 $…$ 안에서 수정하세요. 자료 상자·표 표시와 굵게·밑줄도 편집할 수 있습니다. 저장은 이 문항에만 적용됩니다.</p>
              <QuestionTextEditor value={draft} disabled={working} onCursor={() => {}} onChange={text => { setDraft(text); setNotice(''); setEditError(''); }} />
              {editError && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive">{editError}</p>}
              {notice && <output className="block text-sm leading-6 text-primary">{notice}</output>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={working} onClick={checkDraft}>수식 검사</Button>
                <Button disabled={working || !dirty} onClick={() => void saveEdit()}>{working ? <LoaderCircle className="animate-spin" /> : <Save />}수정 저장</Button>
                <Button variant="ghost" disabled={working} onClick={() => { if (discardDraft()) { setEditing(null); setNotice(''); } }}>편집 닫기</Button>
              </div>
              <div className="min-w-0 rounded-lg border bg-background p-3"><h4 className="mb-2 text-sm font-semibold">수정 미리보기</h4><Suspense fallback={<p className="text-sm text-muted-foreground">미리보기 준비 중…</p>}><MathText text={previewDraft} /></Suspense></div>
            </section>}
            {preview ? <><p className="mb-3 break-words text-sm font-semibold">{preview.sourceFileName} · {preview.number}번</p>{preview.questionCaptures?.map((capture, index) => <figure key={index} className="mb-3"><figcaption className="mb-1 text-sm text-muted-foreground">원본 {capture.page}쪽</figcaption>{/* Local, confidential captures must not be sent to an image optimizer. */}{/* oxlint-disable-next-line next/no-img-element */}<img src={capture.image} alt={`${preview.number}번 문항 원문 캡처 ${index + 1}`} className="h-auto w-full rounded border bg-white" /></figure>)}</> : <p className="text-sm leading-6 text-muted-foreground">‘원문 캡처 보기’를 누르면 저장된 발문·그림·선택지를 확인할 수 있습니다.</p>}
          </aside>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-sm text-muted-foreground">{dirty ? '수정 내용을 저장하거나 취소한 뒤 내보내세요.' : '선택한 순서로 묶습니다. 검색을 바꿔도 선택은 유지됩니다.'}</p><Button disabled={working || dirty || !selected.length} onClick={() => void retrieve(selected, true)}>{working ? <LoaderCircle className="animate-spin" /> : <Download />}선택 {selected.length}문항 내보내기</Button></div>
      </DialogContent>
    </Dialog>
    {exportQuestions && <ExportDialog fileName="내 문제함" questions={exportQuestions} onClose={() => setExportQuestions(null)} />}
  </>;
}
