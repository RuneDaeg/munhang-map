'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileDown,
  FileText,
  FolderOpen,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  PanelLeft,
  ScanSearch,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzePdf,
  classifyQuestion,
  loadAchievementStandards,
  type AnalyzedQuestion,
  type StandardRecord,
} from '@/lib/pdf-analysis';
import { downloadDocx, downloadHwpx } from '@/lib/document-export';

const sampleQuestions: AnalyzedQuestion[] = [
  {
    number: 1,
    type: '객관식 · 3점',
    text: '그림은 수평면에서 일정한 속력으로 직선 운동하는 물체의 위치를 시간에 따라 나타낸 것이다. 이 물체의 운동에 대한 설명으로 옳은 것만을 <보기>에서 고른 것은?',
    standardCode: '[12물리01-02]',
    standard: '뉴턴 운동 법칙으로 등가속도 운동을 설명하고, 교통안전 사고 예방에 적용할 수 있다.',
    confidence: 96,
    domain: '고등학교 · 물리학',
  },
  {
    number: 2,
    type: '객관식 · 3점',
    text: '질량이 같은 두 물체 A, B가 각각 다른 높이에서 자유 낙하한다. 두 물체가 지면에 도달하기 직전의 운동량을 비교한 것으로 옳은 것은?',
    standardCode: '[12물리01-03]',
    standard: '작용과 반작용 관계와 운동량 보존 법칙을 알고, 스포츠, 교통수단, 발사체 등에 적용할 수 있다.',
    confidence: 91,
    domain: '고등학교 · 물리학',
  },
  {
    number: 3,
    type: '객관식 · 2점',
    text: '전자기파 A, B의 진동수와 파장에 대한 설명으로 옳은 것을 고르시오.',
    standardCode: '[12물리03-01]',
    standard: '빛의 중첩과 간섭을 통해 빛의 파동성을 알고, 이를 이용한 기술과 현상을 예를 들어 설명할 수 있다.',
    confidence: 78,
    domain: '고등학교 · 물리학',
  },
];

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('예시 · 2026학년도 6월 모의평가_물리학Ⅰ.pdf');
  const [selected, setSelected] = useState(0);
  const [questionData, setQuestionData] = useState(sampleQuestions);
  const [pageCount, setPageCount] = useState(24);
  const [status, setStatus] = useState<'ready' | 'analyzing' | 'error'>('ready');
  const [error, setError] = useState('');
  const [qualityWarning, setQualityWarning] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isDemo, setIsDemo] = useState(true);
  const [standards, setStandards] = useState<StandardRecord[]>([]);

  useEffect(() => {
    void loadAchievementStandards().then((items) => {
      setStandards(items);
      setQuestionData((current) => current.map((question) => classifyQuestion(question, items)));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    type Context = { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'get_exam_analysis_summary',
        title: '시험지 분석 요약 조회',
        description: '현재 화면의 PDF 이름, 문항 수, 성취기준 수와 평균 신뢰도를 조회합니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({ fileName, questionCount: questionData.length, standardCount: new Set(questionData.map((q) => q.standardCode)).size, averageConfidence: average(questionData) }),
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'select_exam_question',
        title: '검토할 문항 선택',
        description: '문항 번호를 선택해 같은 문항을 화면의 검토 패널에 표시합니다.',
        inputSchema: { type: 'object', properties: { questionNumber: { type: 'integer', minimum: 1 } }, required: ['questionNumber'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: unknown) => {
          const number = Number((input as { questionNumber?: number }).questionNumber);
          const index = questionData.findIndex((question) => question.number === number);
          if (index < 0) throw new Error('해당 문항 번호가 없습니다.');
          setSelected(index);
          return { selectedQuestion: number };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [fileName, questionData]);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 선택할 수 있습니다.');
      setStatus('error');
      return;
    }
    setFileName(file.name);
    setQuestionData([]);
    setPageCount(0);
    setStatus('analyzing');
    setAnalysisProgress(0);
    setIsDemo(false);
    setError('');
    setQualityWarning('');
    setSelected(0);
    try {
      const result = await analyzePdf(file, (page, total) => setAnalysisProgress(Math.round((page / total) * 100)));
      if (!result.questions.length) throw new Error('문항을 찾지 못했습니다. 텍스트가 포함된 모의고사 PDF인지 확인해 주세요.');
      setPageCount(result.pageCount);
      setQualityWarning(result.qualityWarning);
      setQuestionData(result.questions);
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PDF 분석 중 오류가 발생했습니다.');
      setStatus('error');
    }
  }

  function updateSelectedText(text: string) {
    setQuestionData((current) => current.map((question, index) => index === selected ? { ...question, text } : question));
  }

  function updateSelectedStandard(code: string) {
    const current = questionData[selected];
    const candidate = current?.standardCandidates?.find((item) => item.code === code);
    if (!candidate) return;
    setQuestionData((current) => current.map((question, index) => index === selected ? {
      ...question,
      standardCode: candidate.code,
      standard: candidate.standard,
      domain: candidate.domain,
      confidence: candidate.confidence,
    } : question));
  }

  function updateSelectedSubject(subjectKey: string) {
    setQuestionData((current) => current.map((question, index) => index === selected ? classifyQuestion(question, standards, subjectKey) : question));
  }

  function refreshSelectedCandidates() {
    setQuestionData((current) => current.map((question, index) => index === selected ? classifyQuestion(question, standards) : question));
  }

  function splitSelectedQuestion(position: number) {
    const question = questionData[selected];
    if (!question || position < 8 || position > question.text.length - 8) return;
    const firstText = question.text.slice(0, position).trim();
    let secondText = question.text.slice(position).trim();
    const marker = secondText.match(/^(\d{1,2})\s*[.)]\s*/);
    const secondNumber = marker ? Number(marker[1]) : question.number + 1;
    if (marker) secondText = secondText.slice(marker[0].length).trim();
    const first = classifyQuestion({ ...question, text: firstText }, standards);
    const second = classifyQuestion({ ...question, number: secondNumber, text: secondText, type: question.type.replace('자동 추출', '수동 분리') }, standards);
    setQuestionData((current) => [...current.slice(0, selected), first, second, ...current.slice(selected + 1)]);
    setSelected(selected + 1);
  }

  function mergeWithPrevious() {
    if (selected === 0) return;
    const previous = questionData[selected - 1];
    const current = questionData[selected];
    const merged = classifyQuestion({ ...previous, text: `${previous.text}\n${current.number}. ${current.text}`, type: previous.type.replace('자동 추출', '수동 병합') }, standards);
    setQuestionData((items) => [...items.slice(0, selected - 1), merged, ...items.slice(selected + 1)]);
    setSelected(selected - 1);
  }

  const standardCount = new Set(questionData.map((question) => question.standardCode)).size;
  const highConfidence = questionData.filter((question) => question.confidence >= 85).length;
  const needsReview = questionData.length - highConfidence;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background/90 px-4 backdrop-blur-xl lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground" aria-label="메뉴 열기">
            <PanelLeft className="size-4" />
          </button>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold tracking-[-0.04em]">문항맵</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">성취기준 분류 작업실</span>
          </div>
        </div>
        <div className="hidden items-center gap-1 rounded-full bg-muted p-1 text-sm md:flex">
          {['파일 불러오기', '문항 검토', '내보내기'].map((step, index) => (
            <div key={step} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${index === 1 ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground'}`}>
              <span className={`grid size-5 place-items-center rounded-full text-[11px] ${index === 0 ? 'bg-primary text-white' : index === 1 ? 'bg-accent text-accent-foreground' : 'bg-border'}`}>
                {index === 0 ? <Check className="size-3" /> : index + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
        <div className="flex flex-1 justify-end">
          <Button variant="ghost" size="icon" aria-label="도움말"><CircleHelp /></Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1540px] gap-4 p-4 lg:grid-cols-[270px_minmax(0,1fr)] lg:p-6">
        <aside className="workspace-sidebar rounded-[22px] p-5 text-white lg:sticky lg:top-[88px] lg:h-[calc(100vh-112px)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">현재 작업</p>
            <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" aria-label="더보기"><MoreHorizontal /></Button>
          </div>
          <button onClick={() => inputRef.current?.click()} className="mt-3 w-full rounded-2xl border border-white/12 bg-white/7 p-4 text-left transition hover:bg-white/10">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><FileText className="size-5" /></span>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-5">{fileName}</p>
                <p className="mt-1 text-xs text-white/50">{status === 'analyzing' ? `분석 중 · ${analysisProgress}%` : pageCount ? `${pageCount}쪽 · 문항 ${questionData.length}개` : '분석 결과 없음'}</p>
              </div>
            </div>
          </button>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onClick={(event) => { event.currentTarget.value = ''; }} onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} />

          <div className="mt-6 space-y-3">
            <label className="block text-xs font-medium text-white/55">교육과정</label>
            <NativeSelect className="w-full [&_select]:border-white/12 [&_select]:bg-white/7 [&_select]:text-white">
              <NativeSelectOption>2022 개정 교육과정 · 원본 CSV</NativeSelectOption>
            </NativeSelect>
            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <p className="text-xs font-semibold text-white/80">교과는 문항별로 추천됩니다</p>
              <p className="mt-1 text-xs leading-5 text-white/50">각 문항에서 관련성이 높은 교과 후보만 확인하고 선택할 수 있습니다.</p>
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/55">검토 완료</span>
              <strong className="text-accent">{highConfidence} / {questionData.length}</strong>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${questionData.length ? (highConfidence / questionData.length) * 100 : 0}%` }} /></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/6 p-3"><p className="text-xl font-bold">{standardCount}</p><p className="text-[11px] text-white/45">성취기준</p></div>
              <div className="rounded-xl bg-white/6 p-3"><p className="text-xl font-bold">{average(questionData)}%</p><p className="text-[11px] text-white/45">평균 신뢰도</p></div>
            </div>
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <p className="flex items-center gap-2 text-xs text-white/45"><Sparkles className="size-3.5 text-accent" /> PDF는 이 브라우저에서만 처리됩니다</p>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-col gap-4 rounded-[22px] border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{status === 'analyzing' ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <ScanSearch className="size-4 text-primary" />} {status === 'analyzing' ? `PDF에서 문항을 찾는 중 · ${analysisProgress}%` : status === 'error' ? '분석을 완료하지 못했습니다' : isDemo ? '예시 분석 결과' : '새 PDF 분석 완료'}</div>
                <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] sm:text-[28px]">문항과 성취기준을 확인하세요</h1>
                {error && <p role="alert" className="mt-2 max-w-2xl text-sm font-medium leading-6 text-destructive">{error} 다른 PDF를 선택하면 새로 분석합니다.</p>}
                {qualityWarning && <p role="status" className="mt-2 max-w-2xl rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium leading-6 text-amber-800">{qualityWarning}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload /> PDF 바꾸기</Button>
                <Button onClick={() => setExportOpen(true)} disabled={status === 'analyzing' || !questionData.length} className="bg-primary px-4 text-primary-foreground hover:bg-primary/90"><Download /> 문서 내보내기</Button>
              </div>
            </div>

            <Tabs defaultValue="questions" className="mt-1">
              <div className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
                <TabsList variant="line" className="h-10">
                  <TabsTrigger value="questions" className="px-3"><LayoutGrid /> 문항별 보기</TabsTrigger>
                  <TabsTrigger value="standards" className="px-3"><ListFilter /> 성취기준별 보기</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2 pb-3 sm:pb-0">
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">높은 신뢰도 {highConfidence}</Badge>
                  <Badge variant="secondary" className="bg-amber-50 text-amber-700">확인 필요 {needsReview}</Badge>
                </div>
              </div>

              <TabsContent value="questions" className="pt-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                  <div className="min-w-0 overflow-hidden rounded-2xl border bg-background">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div className="flex items-center gap-2"><FolderOpen className="size-4 text-muted-foreground" /><span className="text-sm font-semibold">문항 목록</span><span className="text-xs text-muted-foreground">{questionData.length}개</span></div>
                      <div className="flex items-center gap-1"><Button onClick={() => setSelected((value) => Math.max(0, value - 1))} disabled={selected === 0} variant="ghost" size="icon-sm" aria-label="이전 문항"><ChevronLeft /></Button><span className="px-1 text-xs tabular-nums">{selected + 1} / {questionData.length}</span><Button onClick={() => setSelected((value) => Math.min(questionData.length - 1, value + 1))} disabled={selected >= questionData.length - 1} variant="ghost" size="icon-sm" aria-label="다음 문항"><ChevronRight /></Button></div>
                    </div>
                    <div className="divide-y">
                      {!questionData.length && (
                        <Empty className="min-h-[360px] border-0">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">{status === 'analyzing' ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}</EmptyMedia>
                            <EmptyTitle>{status === 'analyzing' ? 'PDF를 읽고 있습니다' : '표시할 문항이 없습니다'}</EmptyTitle>
                            <EmptyDescription>{status === 'analyzing' ? `전체 페이지의 텍스트와 문항 번호를 확인하는 중입니다. ${analysisProgress}%` : '오류 내용을 확인한 뒤 다른 PDF를 선택해 주세요.'}</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                      {questionData.map((question, index) => (
                        <button key={`${question.number}-${index}`} onClick={() => setSelected(index)} className={`group grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 p-4 text-left transition sm:grid-cols-[54px_minmax(0,1fr)_auto] ${selected === index ? 'bg-selected' : 'hover:bg-muted/50'}`}>
                          <span className={`grid size-11 place-items-center rounded-2xl text-lg font-extrabold ${selected === index ? 'bg-primary text-white' : 'bg-muted text-foreground'}`}>{String(question.number).padStart(2, '0')}</span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">{question.type}</span><Badge variant="outline" className="h-5 border-primary/15 bg-primary/5 text-primary">{question.domain}</Badge></span>
                            <span className="mt-2 line-clamp-2 block text-[15px] font-medium leading-6">{question.text}</span>
                          </span>
                          <span className="col-start-2 flex items-center gap-2 self-center sm:col-start-auto">
                            <span className={`size-2 rounded-full ${question.confidence >= 85 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">{question.confidence}%</span>
                            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t bg-muted/35 px-4 py-3 text-center text-xs text-muted-foreground">문항 텍스트와 추천 성취기준은 내보내기 전에 직접 수정할 수 있습니다</div>
                  </div>

                  {questionData[selected] && <QuestionInspector question={questionData[selected]} canMerge={selected > 0} onTextChange={updateSelectedText} onStandardChange={updateSelectedStandard} onSubjectChange={updateSelectedSubject} onRefresh={refreshSelectedCandidates} onSplit={splitSelectedQuestion} onMerge={mergeWithPrevious} />}
                </div>
              </TabsContent>

              <TabsContent value="standards" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {questionData.map((question) => (
                    <article key={`${question.standardCode}-${question.number}`} className="rounded-2xl border bg-background p-5">
                      <div className="flex items-start justify-between gap-3"><Badge className="bg-primary/10 text-primary">{question.standardCode}</Badge><span className="text-xs font-semibold text-muted-foreground">{question.confidence}% 일치</span></div>
                      <h2 className="mt-4 font-bold">{question.domain}</h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{question.standard}</p>
                      <p className="mt-4 text-xs font-semibold text-primary">연결 문항 {question.number}번</p>
                    </article>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </section>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} fileName={fileName} questions={questionData} />
      <footer className="mx-auto flex max-w-[1540px] flex-col gap-2 px-6 pb-8 text-xs leading-5 text-muted-foreground sm:flex-row sm:justify-between">
        <span>성취기준 데이터: worksheet-grab · 2022 개정 교육과정</span>
        <span className="flex flex-wrap gap-x-4"><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/pblsketch/worksheet-grab/tree/090e24e331f779a2e329cf686c5c5444f9221ca9/data" target="_blank" rel="noreferrer">데이터 출처</a><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/jkf87/hwpx-skill" target="_blank" rel="noreferrer">HWPX 구현 참고</a></span>
      </footer>
    </main>
  );
}

function QuestionInspector({ question, canMerge, onTextChange, onStandardChange, onSubjectChange, onRefresh, onSplit, onMerge }: {
  question: AnalyzedQuestion;
  canMerge: boolean;
  onTextChange: (text: string) => void;
  onStandardChange: (code: string) => void;
  onSubjectChange: (subjectKey: string) => void;
  onRefresh: () => void;
  onSplit: (position: number) => void;
  onMerge: () => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const subjectCandidates = question.subjectCandidates ?? [{ key: question.domain.replace(' · ', '|'), label: question.domain, confidence: question.confidence }];
  const standardCandidates = question.standardCandidates ?? [{ code: question.standardCode, standard: question.standard, domain: question.domain, confidence: question.confidence }];
  const selectedSubject = subjectCandidates.find((candidate) => candidate.label === question.domain)?.key ?? subjectCandidates[0]?.key ?? '';
  return (
    <aside className="overflow-hidden rounded-2xl border bg-background">
      <div className="inspector-head p-5 text-white">
        <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">문항별 추천 결과</p><Badge className="bg-white/12 text-white">후보 {standardCandidates.length}개</Badge></div>
        <p className="mt-5 font-mono text-2xl font-bold tracking-tight text-accent">{question.standardCode}</p>
        <p className="mt-2 text-lg font-bold">{question.domain}</p>
      </div>
      <div className="p-5">
        <Textarea ref={textRef} aria-label="문항 텍스트" value={question.text} onChange={(event) => onTextChange(event.target.value)} onSelect={(event) => setCursor(event.currentTarget.selectionStart)} className="min-h-40 resize-y border-0 bg-transparent p-0 text-sm leading-6 shadow-none focus-visible:ring-0" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={cursor < 8 || cursor > question.text.length - 8} onClick={() => onSplit(cursor)}>커서에서 문항 나누기</Button>
          <Button variant="outline" size="sm" disabled={!canMerge} onClick={onMerge}>이전 문항과 합치기</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">경계가 틀리면 새 문항이 시작되는 위치에 커서를 놓고 나누세요.</p>
        <div className="my-5 h-px bg-border" />
        <div>
          <label className="text-xs font-semibold text-muted-foreground">이 문항의 교과 후보</label>
          <NativeSelect value={selectedSubject} onChange={(event) => onSubjectChange(event.target.value)} className="mt-2 w-full">
            {subjectCandidates.map((candidate) => <NativeSelectOption key={candidate.key} value={candidate.key}>{candidate.label} · {candidate.confidence}%</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="mt-5">
          <label className="text-xs font-semibold text-muted-foreground">성취기준 후보</label>
          <NativeSelect value={question.standardCode} onChange={(event) => onStandardChange(event.target.value)} className="mt-2 w-full">
            {standardCandidates.map((candidate) => <NativeSelectOption key={candidate.code} value={candidate.code}>{candidate.code} · {candidate.confidence}%</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <p className="mt-4 rounded-xl border border-primary/10 bg-primary/5 p-4 text-sm leading-6 text-foreground/80">{question.standard}</p>
        <Button variant="outline" className="mt-3 w-full" onClick={onRefresh}>수정한 문장으로 후보 다시 찾기 <ScanSearch /></Button>
      </div>
    </aside>
  );
}

function ExportDialog({ open, onOpenChange, fileName, questions }: { open: boolean; onOpenChange: (open: boolean) => void; fileName: string; questions: AnalyzedQuestion[] }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    if (!open) return;
    setExportError('');
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onOpenChange(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onOpenChange]);
  async function handleHwpxExport() {
    setExporting(true);
    setExportError('');
    try {
      await downloadHwpx(fileName, questions);
      onOpenChange(false);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'HWPX 생성에 실패했습니다.');
    } finally {
      setExporting(false);
    }
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4 backdrop-blur-sm" onMouseDown={() => onOpenChange(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="export-title" className="w-full max-w-lg rounded-2xl bg-popover p-5 shadow-2xl ring-1 ring-foreground/10" onMouseDown={(event) => event.stopPropagation()}>
        <div>
          <h2 id="export-title" className="text-lg font-bold">문서 형식을 선택하세요</h2>
          <p className="mt-2 text-sm text-muted-foreground">문항, 추천 성취기준, 분류 영역이 하나의 편집 가능한 문서로 저장됩니다.</p>
        </div>
        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <button onClick={() => { downloadDocx(fileName, questions); onOpenChange(false); }} className="group rounded-2xl border p-4 text-left transition hover:border-primary hover:bg-primary/5">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><FileDown className="size-5" /></span>
            <strong className="mt-4 block">Word 문서</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">DOCX · 문항별 문서화</span>
          </button>
          <button disabled={exporting} onClick={() => void handleHwpxExport()} className="group rounded-2xl border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:opacity-60">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileDown className="size-5" /></span>
            <div className="mt-4 flex items-center gap-2"><strong>한글 문서</strong><Badge variant="secondary" className="text-[10px]">검증 템플릿</Badge></div>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{exporting ? 'HWPX 조립 중…' : 'HWPX · 한글 2020 이상'}</span>
          </button>
        </div>
        {exportError && <p role="alert" className="pb-2 text-xs font-medium text-destructive">{exportError}</p>}
        <div className="-mx-5 -mb-5 mt-2 flex items-center gap-2 rounded-b-2xl border-t bg-muted/50 p-4">
          <p className="mr-auto self-center text-xs text-muted-foreground">총 {questions.length}개 문항</p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
        </div>
      </section>
    </div>
  );
}

function average(items: AnalyzedQuestion[]) {
  if (!items.length) return 0;
  return Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / items.length);
}
