'use client';

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { splitFormattedText } from '@/lib/text-formatting';
import { validateExamQuestions } from '@/lib/question-validation';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  FolderOpen,
  LayoutGrid,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  PanelLeft,
  ScanSearch,
  ShieldAlert,
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
import QuestionTextEditor, { type QuestionEditorHandle } from '@/components/question-text-editor';
import {
  classifyQuestion,
  loadAchievementStandards,
  type AnalyzedQuestion,
  type StandardRecord,
} from '@/lib/pdf-analysis';
import { enhanceQuestionsWithVision, getVisionStatus, openApiConnectionSettings, type VisionStatus } from '@/lib/vision-recognition';
import { recognizeQuestionBatch, type BatchRecognitionProgress } from '@/lib/batch-recognition';
import { CaptureEditor } from '@/components/capture-editor';
import { downloadReview, parseReview } from '@/lib/review-file';
import type { QuestionCapture } from '@/lib/question-capture';
import { normalizeQuestionText } from '@/lib/math-normalization';
import { questionStructures } from '@/lib/question-content';
import { countUnresolvedGlyphs, glyphWarning } from '@/lib/pdf-text';
import { runExamAnalysis, type AnalysisProgress as ProgressState } from '@/lib/analysis-workflow';
import { AnalysisProgress } from '@/components/analysis-progress';
import { ExportDialog } from '@/components/export-dialog';
import { QuestionBank } from '@/components/question-bank';
import { saveToQuestionBank } from '@/lib/question-bank';
import { version } from '@/package.json';

const MathText = lazy(() => import('@/components/math-text'));

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
  const reviewInputRef = useRef<HTMLInputElement>(null);
  const [sourcePages, setSourcePages] = useState<string[]>([]);
  const [editingCapture, setEditingCapture] = useState<number | null>(null);
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
  const checkedQuestions = useMemo(()=>validateExamQuestions(questionData,standards.length ? standards : undefined),[questionData,standards]);
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [visionModel, setVisionModel] = useState('');
  const [visionProvider, setVisionProvider] = useState('');
  const [visionKeyHint, setVisionKeyHint] = useState('');
  const [visionUsage, setVisionUsage] = useState<VisionStatus['usage']>();
  const [visionRemaining, setVisionRemaining] = useState<number | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const [visionProgress, setVisionProgress] = useState('');
  const [visionError, setVisionError] = useState('');
  const [recognizingQuestion, setRecognizingQuestion] = useState<number | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchRecognitionProgress | null>(null);
  const [batchMessage, setBatchMessage] = useState('');
  const [batchStopping, setBatchStopping] = useState(false);
  const batchStopRef = useRef(false);
  const [analysisState, setAnalysisState] = useState<ProgressState | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [bankMessage, setBankMessage] = useState('');
  const operationRef = useRef(false);
  const busy = status === 'analyzing' || recognizingQuestion !== null || savingBank || batchRunning;

  useEffect(() => {
    void loadAchievementStandards().then((items) => {
      setStandards(items);
      setQuestionData((current) => current.map((question) => classifyQuestion(question, items)));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    void getVisionStatus().then(applyVisionStatus).catch(() => undefined);
  }, []);

  function applyVisionStatus(vision: VisionStatus) {
    setVisionAvailable(vision.available);
    setVisionModel(vision.model);
    setVisionProvider(vision.providerLabel ?? '');
    setVisionKeyHint(vision.keyHint ?? '');
    setVisionUsage(vision.usage);
    setVisionRemaining(typeof vision.estimatedRemainingUsd === 'number' ? vision.estimatedRemainingUsd : null);
    setDesktopMode(Boolean(vision.desktop));
    setLocalMode(Boolean(vision.local && !vision.desktop));
  }

  useEffect(() => {
    type Context = { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'get_exam_analysis_summary',
        title: '시험지 분석 요약 조회',
        description: '현재 화면의 PDF 이름, 문항 수, 성취기준 수와 자동 검토 항목 수를 조회합니다. 정확도는 아닙니다.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({ fileName, questionCount: checkedQuestions.length, standardCount: new Set(checkedQuestions.map((q) => q.standardCode).filter(Boolean)).size, reviewQuestionCount: checkedQuestions.filter(q=>q.validationFlags?.length).length }),
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
  }, [fileName, questionData, checkedQuestions]);

  async function handleFile(file: File) {
    if (operationRef.current || recognizingQuestion !== null || savingBank) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('PDF 파일만 선택할 수 있습니다.'); return; }
    operationRef.current = true;
    setFileName(file.name); setSourcePages([]); setEditingCapture(null); setQuestionData([]); setPageCount(0);
    setStatus('analyzing'); setAnalysisProgress(0); setAnalysisState(null); setIsDemo(false);
    setError(''); setQualityWarning(''); setVisionError(''); setVisionProgress(''); setBankMessage(''); setSelected(0);
    setBatchMessage(''); setBatchProgress(null);
    try {
      const result = await runExamAnalysis(file, (progress) => {
        setAnalysisState(progress); setAnalysisProgress(progress.percent); setVisionProgress(progress.detail);
      });
      setPageCount(result.pageCount); setSourcePages(result.sourcePages); setStandards(result.catalog);
      setQualityWarning(result.qualityWarning); setQuestionData(result.questions);
      setVisionProgress(''); setStatus('ready');
      void getVisionStatus().then(applyVisionStatus).catch(() => undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PDF 분석 중 오류가 발생했습니다.'); setStatus('error');
    } finally { operationRef.current = false; }
  }

  async function saveCurrentToBank() {
    if (operationRef.current || status !== 'ready' || recognizingQuestion !== null || savingBank || isDemo) return;
    setSavingBank(true); setBankMessage('');
    try {
      const result = await saveToQuestionBank(fileName, checkedQuestions, sourcePages);
      setBankMessage(`${result.saved}문항을 내 문제함에 ${result.updated ? '업데이트' : '저장'}했습니다. 다른 PDF의 문항과 함께 선택해 내보낼 수 있습니다.`);
    } catch (reason) { setBankMessage(reason instanceof Error ? reason.message : '문제함에 저장하지 못했습니다.'); }
    finally { setSavingBank(false); }
  }

  function updateSelectedText(text: string) {
    setQuestionData((current) => current.map((question, index) => index === selected ? { ...question, text, assessmentText:undefined, mappingReason:undefined, validationFlags:undefined, textEdited:true, visionEnhanced: false } : question));
  }

  async function handleReviewFile(file: File) {
    if (operationRef.current || recognizingQuestion !== null || savingBank) return;
    if (file.size > 80_000_000) { setError('검토 파일은 80MB 이하만 열 수 있습니다.'); return; }
    operationRef.current = true; setAnalysisState(null); setAnalysisProgress(0); setBankMessage('');
    setBatchMessage(''); setBatchProgress(null);
    setStatus('analyzing'); setEditingCapture(null); setError(''); setVisionError(''); setVisionProgress('저장한 캡처 범위를 불러오는 중');
    try {
      const review = await parseReview(await file.text());
      const catalog = standards.length ? standards : await loadAchievementStandards();
      const questions = review.questions.map((question) => {
        const classified = classifyQuestion(question, catalog);
        const chosen = classified.standardCandidates?.find((candidate) => candidate.code === question.standardCode);
        return chosen ? { ...classified, standardCode: chosen.code, standard: chosen.standard, confidence: chosen.confidence, domain: chosen.domain } : classified;
      });
      setStandards(catalog); setQuestionData(questions); setSourcePages(review.sourcePages); setFileName(review.fileName);
      setPageCount(review.sourcePages.length); setSelected(0); setIsDemo(false); setQualityWarning(''); setStatus('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '검토 파일을 열지 못했습니다.'); setStatus('error'); }
    finally { setVisionProgress(''); operationRef.current = false; }
  }

  function saveCaptureEdits(captures: QuestionCapture[]) {
    setQuestionData((questions) => questions.map((question, index) => index === editingCapture ? { ...question, questionCaptures: captures, type: question.type.replace(/\d+쪽/, `${captures[0].page}쪽`), sourcePageImage: sourcePages[captures[0].page - 1], captureReviewed: true, captureWarning: undefined, visualChoices:undefined, analysisWarning:question.visualChoices?.length?'캡처 범위를 변경했습니다. 그림 선택지는 수정된 문항 전체 캡처를 기준으로 확인하세요.':question.analysisWarning, visionEnhanced: false } : question));
    setEditingCapture(null);
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
      mappingReason: candidate.reason ?? '사용자가 성취기준을 직접 선택했습니다.',
    } : question));
  }

  function updateSelectedSubject(subjectKey: string) {
    setQuestionData((current) => current.map((question, index) => index === selected ? classifyQuestion(question, standards, subjectKey) : question));
  }

  function refreshSelectedCandidates() {
    setQuestionData((current) => current.map((question, index) => index === selected ? classifyQuestion(question, standards) : question));
  }

  async function recognizeSelectedQuestion() {
    const question = questionData[selected];
    if (!question?.questionCaptures?.length || operationRef.current || recognizingQuestion !== null || savingBank || status === 'analyzing') return;
    operationRef.current = true;
    const targetIndex=selected;
    setRecognizingQuestion(question.number);
    setVisionError('');
    try {
      const connection = await getVisionStatus();
      applyVisionStatus(connection);
      if (!connection.available) throw new Error(connection.desktop || connection.local ? '먼저 API 연결을 설정해 주세요. 기본 분석과 성취기준 추천은 API 없이 사용할 수 있습니다.' : '로컬 .env.local에 OPENAI_API_KEY를 설정한 뒤 개발 서버를 다시 시작해 주세요.');
      const message = [
        `${question.number}번 문항의 캡처 이미지와 추출문을 ${connection.providerLabel || '연결된 AI 공급자'}에 전송하여 판독할까요?`,
        '해당 문항에 연결된 공통 지문도 포함될 수 있습니다. API 요금이 발생할 수 있으며 판독 결과로 현재 내용을 갱신합니다.',
        '미공개 시험지·개인정보 등 외부 반출 금지 자료라면 취소하세요. API 키를 로컬에 저장해도 판독 자료는 선택한 공급자 또는 설정한 서버로 전송됩니다.',
        ...(question.textEdited ? ['직접 편집한 내용이 있습니다. 계속하기 전에 검토 파일 저장을 권장합니다.'] : []),
      ].join('\n\n');
      if (!window.confirm(message)) return;
      const result = await enhanceQuestionsWithVision([question]);
      if (result.failures.length) throw new Error(result.failures[0]);
      if (result.warnings.length) setVisionError(result.warnings.join(' '));
      const catalog = standards.length ? standards : await loadAchievementStandards();
      setStandards(catalog);
      const enhanced = classifyQuestion(result.questions[0], catalog);
      setQuestionData((current) => current.map((item, index) => index === targetIndex && item===question ? {...enhanced,textEdited:enhanced.text===question.text ? question.textEdited : false} : item));
      void getVisionStatus().then(applyVisionStatus).catch(() => undefined);
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : '선택 문항의 API 판독을 완료하지 못했습니다.');
    } finally {
      setRecognizingQuestion(null);
      operationRef.current = false;
    }
  }

  async function recognizeAllQuestions() {
    if (operationRef.current || busy || isDemo || !questionData.length || status !== 'ready') return;
    operationRef.current = true;
    setBatchRunning(true); setBatchStopping(false); batchStopRef.current = false;
    setVisionError(''); setBatchMessage(''); setBatchProgress(null);
    const snapshot = [...questionData];
    try {
      const missing = snapshot.filter(question => !question.questionCaptures?.length);
      if (missing.length) throw new Error(`${missing.map(question => question.number).join(', ')}번의 문항 캡처가 없습니다. 먼저 캡처 범위를 지정하세요.`);
      if (snapshot.length > 200) throw new Error('전체 API 판독은 200문항 이하로 나누어 실행하세요.');
      const connection = await getVisionStatus();
      applyVisionStatus(connection);
      if (!connection.available) throw new Error('먼저 API 연결을 설정해 주세요. 기본 분석과 성취기준 추천은 API 없이 사용할 수 있습니다.');
      const edited = snapshot.filter(question => question.textEdited).length;
      if (!window.confirm([
        `현재 시험지 전체 ${snapshot.length}문항의 캡처 이미지와 추출문을 ${connection.providerLabel || '연결된 AI 공급자'}에 전송하여 판독할까요?`,
        `문항마다 순서대로 요청하며 최대 ${snapshot.length}회의 API 판독 비용이 발생할 수 있습니다. 연결된 공통 지문도 포함될 수 있습니다. 이미 판독한 문항도 다시 요청합니다.`,
        '미공개 시험지·개인정보 등 외부 반출 금지 자료라면 취소하세요. API 키를 로컬에 저장해도 판독 자료는 선택한 공급자 또는 설정한 서버로 전송됩니다.',
        '진행 중 중단하면 현재 요청까지만 마칩니다. 이미 전송된 요청에는 비용이 발생할 수 있습니다. 완료된 결과는 유지하고, 실패하면 다음 요청을 멈춥니다.',
        ...(edited ? [`직접 편집한 문항이 ${edited}개 있습니다. 결과로 갱신하기 전에 검토 저장으로 백업하는 것을 권장합니다.`] : []),
      ].join('\n\n'))) return;
      const catalog = standards.length ? standards : await loadAchievementStandards();
      setStandards(catalog);
      const result = await recognizeQuestionBatch(snapshot, {
        recognize: enhanceQuestionsWithVision,
        shouldStop: () => batchStopRef.current,
        onProgress: progress => { setBatchProgress(progress); setRecognizingQuestion(progress.current); },
      });
      const updates = new Map(result.updates.map(({ source, question }) => [source, { ...classifyQuestion(question, catalog), textEdited: question.text === source.text ? source.textEdited : false }]));
      // Match the immutable source object, not the current selection or list index.
      // Edits, merges, splits and capture changes made while waiting remain intact.
      setQuestionData(current => current.map(question => updates.get(question) ?? question));
      const remaining = result.total - result.attempted;
      setBatchMessage(`${result.stopped ? '전체 판독 중단' : result.failures.length ? '오류로 전체 판독 중단' : '전체 API 판독 처리 완료'} · 응답 완료 ${result.completed}/${result.total}문항 · 실패 ${result.failures.length}문항 · 미요청 ${remaining}문항. 진행 중 직접 수정한 문항은 덮어쓰지 않습니다. 원문과 대조해 주세요.`);
      if (result.failures.length || result.warnings.length) setVisionError([...result.failures, ...result.warnings].join(' '));
      void getVisionStatus().then(applyVisionStatus).catch(() => undefined);
    } catch (reason) {
      setVisionError(reason instanceof Error ? reason.message : '전체 문항 API 판독을 완료하지 못했습니다.');
    } finally {
      setBatchRunning(false); setRecognizingQuestion(null); setBatchStopping(false); operationRef.current = false;
    }
  }

  function splitSelectedQuestion(position: number) {
    const question = questionData[selected];
    if (!question || position < 8 || position > question.text.length - 8) return;
    const [left,right] = splitFormattedText(question.text,position);
    const firstText = left.trim();
    let secondText = right.trim();
    const marker = secondText.match(/^(\d{1,2})\s*[.)]\s*/);
    const secondNumber = marker ? Number(marker[1]) : question.number + 1;
    // Keep the own-question anchor after a manual split of a shared passage.
    if (!marker) secondText = `${secondNumber}. ${secondText}`;
    const captureWarning = '텍스트를 수동으로 나눴습니다. 캡처에는 분리 전 영역이 보존되어 있으므로 범위를 확인해 주세요.';
    const first = classifyQuestion({ ...question, text: firstText, captureWarning, captureReviewed: false, textEdited:true, visualChoices:undefined, analysisWarning:undefined, figureImage: undefined, visionEnhanced: false }, standards);
    const second = classifyQuestion({ ...question, number: secondNumber, text: secondText, captureWarning, captureReviewed: false, textEdited:true, visualChoices:undefined, analysisWarning:undefined, figureImage: undefined, visionEnhanced: false, type: question.type.replace('자동 추출', '수동 분리') }, standards);
    setQuestionData((current) => [...current.slice(0, selected), first, second, ...current.slice(selected + 1)]);
    setSelected(selected + 1);
  }

  function mergeWithPrevious() {
    if (selected === 0) return;
    const previous = questionData[selected - 1];
    const current = questionData[selected];
    const questionCaptures = [...(previous.questionCaptures ?? []), ...(current.questionCaptures ?? [])].filter((capture, index, all) => all.findIndex((item) => item.image === capture.image) === index);
    const merged = classifyQuestion({ ...previous, text: `${previous.text}\n${current.number}. ${current.text}`, questionCaptures, captureReviewed: false, captureWarning: previous.captureWarning ?? current.captureWarning, textEdited:true, visualChoices:undefined, analysisWarning:undefined, figureImage: undefined, visionEnhanced: false, type: previous.type.replace('자동 추출', '수동 병합') }, standards);
    setQuestionData((items) => [...items.slice(0, selected - 1), merged, ...items.slice(selected + 1)]);
    setSelected(selected - 1);
  }

  const standardCount = new Set(questionData.map((question) => question.standardCode)).size;
  const needsReview = checkedQuestions.filter(question=>question.validationFlags?.length).length;
  const noFlags = checkedQuestions.length - needsReview;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background/90 px-4 backdrop-blur-xl lg:px-7">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground" aria-label="메뉴 열기">
            <PanelLeft className="size-4" />
          </button>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold tracking-[-0.04em]">문항맵</span>
            <span className="text-xs text-muted-foreground" aria-label={`앱 버전 ${version}`}>v{version}</span>
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

      <div className="mx-auto max-w-[1540px] px-4 pt-4 lg:px-6 lg:pt-6">
        <div id="document-security-warning" role="note" aria-labelledby="document-security-title" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 text-sm leading-relaxed">
            <h2 id="document-security-title" className="font-bold">외부 반출 금지 문서를 넣지 마세요</h2>
            <p className="mt-1">미공개 시험지·출제 중 문항·개인정보·기관 기밀 등 외부 전송이 금지된 자료는 사용하지 마세요. API 판독 시 문항 캡처와 추출문(공통 지문 포함)이 선택한 AI 공급자 또는 설정한 서버로 전송됩니다.</p>
            <p className="mt-1 text-xs">최초 PDF 분석은 로컬 처리이며, API 판독은 별도 실행·확인 후 전송합니다. 키를 로컬에 저장해도 문서 전송을 막아주지는 않습니다. 문항맵은 반출 금지 여부를 자동 판별하지 않습니다.</p>
          </div>
        </div>
      </div>

      <section className="mx-auto grid max-w-[1540px] gap-4 p-4 lg:grid-cols-[270px_minmax(0,1fr)] lg:p-6">
        <aside aria-label="현재 PDF·API 설정" className="workspace-sidebar rounded-[22px] p-5 text-white lg:sticky lg:top-[88px] lg:h-[calc(100vh-112px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">현재 작업</p>
            <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" aria-label="더보기"><MoreHorizontal /></Button>
          </div>
          <button aria-label="현재 PDF 정보 · 다른 PDF 선택" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-3 w-full rounded-2xl border border-white/12 bg-white/7 p-4 text-left transition hover:bg-white/10 disabled:opacity-60">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"><FileText className="size-5" /></span>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold leading-5">{fileName}</p>
                <p className="mt-1 text-xs text-white/50">{status === 'analyzing' ? `분석 중 · ${analysisProgress}%` : pageCount ? `${pageCount}쪽 · 문항 ${questionData.length}개` : '분석 결과 없음'}</p>
              </div>
            </div>
          </button>
          <input ref={inputRef} aria-label="PDF 파일 선택" disabled={busy} type="file" accept="application/pdf" className="hidden" onClick={(event) => { event.currentTarget.value = ''; }} onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} />
          <input ref={reviewInputRef} aria-label="검토 파일 선택" disabled={busy} type="file" accept=".json,application/json" className="hidden" onClick={(event) => { event.currentTarget.value = ''; }} onChange={(event) => event.target.files?.[0] && void handleReviewFile(event.target.files[0])} />
          <Button variant="outline" disabled={busy} onClick={() => setBankOpen(true)} className="mt-3 w-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"><FolderOpen />내 문제함</Button>

          <div className="mt-6 space-y-3">
            <label htmlFor="curriculum" className="block text-xs font-medium text-white/55">교육과정</label>
            <NativeSelect id="curriculum" className="w-full [&_select]:border-white/12 [&_select]:bg-white/7 [&_select]:text-white">
              <NativeSelectOption>2022 개정 교육과정 · 원본 CSV</NativeSelectOption>
            </NativeSelect>
            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <p className="text-xs font-semibold text-white/80">교과는 문항별로 추천됩니다</p>
              <p className="mt-1 text-xs leading-5 text-white/50">각 문항에서 관련성이 높은 교과 후보만 확인하고 선택할 수 있습니다.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/6 p-3">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${visionAvailable ? 'bg-emerald-400' : 'bg-amber-300'}`} />
                <p className="text-xs font-semibold text-white/80">선택 문항 API {visionAvailable ? '연결됨 · 대기' : '미연결'}</p>
              </div>
              <p className="mt-2 text-sm font-semibold text-accent">첫 분석은 로컬 · 자동 API 판독 꺼짐</p>
              <p className="mt-1 text-xs leading-5 text-white/65">첫 분석은 API 없이 진행합니다. 필요한 문항만 판독하거나 상단 ‘전체 문항 API 판독’을 눌러 전송을 확인하세요.</p>
              <p className="mt-1 whitespace-pre-line text-xs leading-5 text-white/50">{visionAvailable
                ? `${visionProvider || 'AI API'} · ${visionKeyHint || '서버 키'}\n${visionModel}`
                : desktopMode || localMode
                  ? 'API 연결만으로는 전송하지 않습니다. 개별·전체 판독 버튼으로 실행합니다.'
                  : 'API를 설정하지 않아도 로컬 기본 분석을 사용할 수 있습니다.'}</p>
              {visionAvailable && visionUsage && <p className="mt-1 text-xs leading-5 text-white/65">토큰 {formatCompact(visionUsage.inputTokens + visionUsage.outputTokens)} · 앱 추정 ${visionUsage.estimatedUsd.toFixed(4)}{visionRemaining !== null ? ` · 잔액 $${visionRemaining.toFixed(4)}` : ''}</p>}
              {(desktopMode || localMode) && <button type="button" disabled={busy} onClick={() => void openApiConnectionSettings()} className="mt-2 text-xs font-semibold text-accent underline decoration-white/25 underline-offset-4 disabled:opacity-50">API 연결 {visionAvailable ? '변경·사용량 보기' : '설정'}</button>}
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/55">자동 경고 없음 · 정확도 보증 아님</span>
              <strong className="text-accent">{noFlags} / {questionData.length}</strong>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${questionData.length ? (noFlags / questionData.length) * 100 : 0}%` }} /></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/6 p-3"><p className="text-xl font-bold">{standardCount}</p><p className="text-[11px] text-white/45">성취기준</p></div>
              <div className="rounded-xl bg-white/6 p-3"><p className="text-xl font-bold">{needsReview}</p><p className="text-[11px] text-white/45">자동 검토 항목이 있는 문항</p></div>
            </div>
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <p className="flex items-start gap-2 text-xs leading-5 text-white/45"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" /> 캡처는 로컬에서 만듭니다. 개별·전체 API 판독을 확인하면 해당 캡처·추출문이 연결한 AI 공급자에게 전송되며 요금이 발생할 수 있습니다.</p>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-col gap-4 rounded-[22px] border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{status === 'analyzing' ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <ScanSearch className="size-4 text-primary" />} {status === 'analyzing' ? (visionProgress || `PDF에서 문항을 찾는 중 · ${analysisProgress}%`) : status === 'error' ? '분석을 완료하지 못했습니다' : isDemo ? '예시 분석 결과' : '새 PDF 분석 완료'}</div>
                <h1 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] sm:text-[28px]">{status === 'analyzing' ? 'API 없이 문항을 분석하고 있습니다' : '문항과 성취기준을 확인하세요'}</h1>
                {!isDemo && questionData.some((question) => question.examSubject) && <p className="mt-2 text-sm font-medium text-primary">시험지 상단 과목 반영: {[...new Set(questionData.map((question) => question.examSubject?.label).filter(Boolean))].join(' · ')}</p>}
                {error && <p role="alert" className="mt-2 max-w-2xl text-sm font-medium leading-6 text-destructive">{error} 다른 PDF를 선택하면 새로 분석합니다.</p>}
                {qualityWarning && <output className="mt-2 block max-w-2xl rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium leading-6 text-amber-800">{qualityWarning}</output>}
                {visionError && <p role="alert" className="mt-2 max-w-2xl rounded-lg bg-red-50 px-3 py-2 text-sm font-medium leading-6 text-red-700">{visionError}</p>}
                {(batchRunning || batchMessage) && <div className="mt-2 max-w-2xl rounded-lg border bg-muted/40 p-3">
                  <output aria-live="polite" className="block text-sm font-medium">{batchRunning
                    ? batchProgress ? `전체 API 판독 · 응답 완료 ${batchProgress.completed}/${batchProgress.total}문항${batchProgress.current !== null ? ` · ${batchProgress.current}번 요청 중` : ''}${batchStopping ? ' · 현재 문항 후 중단 대기' : ''}` : '전체 API 판독 준비 중'
                    : batchMessage}</output>
                  {batchRunning && batchProgress && <Button size="sm" variant="outline" className="mt-2" disabled={batchStopping} onClick={() => { batchStopRef.current = true; setBatchStopping(true); }}>현재 문항 후 중단</Button>}
                </div>}
                {bankMessage && <output className="mt-2 block max-w-2xl text-sm leading-6 text-primary">{bankMessage}</output>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}><Upload /> PDF 바꾸기</Button>
                <Button variant="outline" disabled={busy || isDemo || status !== 'ready' || !questionData.length} onClick={() => void recognizeAllQuestions()}>{batchRunning ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{batchRunning ? '전체 API 판독 중…' : '전체 문항 API 판독'}</Button>
                <Button variant="outline" onClick={() => reviewInputRef.current?.click()} disabled={busy}>검토 파일 열기</Button>
                <Button variant="outline" onClick={() => downloadReview(fileName, checkedQuestions, sourcePages)} disabled={busy || !sourcePages.length}>검토 저장</Button>
                <Button variant="outline" onClick={() => void saveCurrentToBank()} disabled={busy || isDemo || status !== 'ready' || !sourcePages.length || !questionData.length}>{savingBank ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}{savingBank ? '문제함 저장 중…' : '문제함에 저장'}</Button>
                <Button onClick={() => setExportOpen(true)} disabled={busy || !questionData.length} className="bg-primary px-4 text-primary-foreground hover:bg-primary/90"><Download /> 내보내기</Button>
              </div>
            </div>

            {status === 'analyzing' ? <AnalysisProgress progress={analysisState} detail={visionProgress} /> : <Tabs defaultValue="questions" className="mt-1">
              <div className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
                <TabsList variant="line" className="h-10">
                  <TabsTrigger value="questions" className="px-3"><LayoutGrid /> 문항별 보기</TabsTrigger>
                  <TabsTrigger value="standards" className="px-3"><ListFilter /> 성취기준별 보기</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2 pb-3 sm:pb-0">
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">자동 경고 없음 {noFlags}</Badge>
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
                            <EmptyMedia variant="icon"><ScanSearch /></EmptyMedia>
                            <EmptyTitle>표시할 문항이 없습니다</EmptyTitle>
                            <EmptyDescription>오류 내용을 확인한 뒤 다른 PDF를 선택해 주세요.</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                      {checkedQuestions.map((question, index) => (
                        <article key={`${question.number}-${index}`} onClick={() => setSelected(index)} aria-label={`${question.number}번 추출 문항`} className={`group grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 p-4 text-left transition sm:grid-cols-[54px_minmax(0,1fr)_auto] ${selected === index ? 'bg-selected' : 'hover:bg-muted/50'}`}>
                          <button type="button" onClick={() => setSelected(index)} aria-label={`${question.number}번 문항 정보 보기`} aria-pressed={selected === index} className={`grid size-11 place-items-center rounded-2xl text-lg font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected === index ? 'bg-primary text-white' : 'bg-muted text-foreground'}`}>{String(question.number).padStart(2, '0')}</button>
                          <div className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">{question.type}</span><Badge variant="outline" className="h-5 border-primary/15 bg-primary/5 text-primary">{question.domain}</Badge>{countUnresolvedGlyphs(question.text) ? <Badge variant="secondary" className="h-5 bg-amber-100 text-amber-900">문자 복원 확인 필요</Badge> : question.visionEnhanced && <Badge variant="secondary" className="h-5 bg-emerald-50 text-emerald-700">수식·그림 인식</Badge>}</span>
                            <div className="mt-2 min-w-0 overflow-x-auto text-[15px] font-medium leading-6 focus-visible:outline-2 focus-visible:outline-ring" data-question-preview role="group" aria-label={`${question.number}번 문항 내용`} tabIndex={0}><Suspense fallback={normalizeQuestionText(question.text)}><MathText text={question.text} compact /></Suspense></div>
                          </div>
                          <span className="col-start-2 flex items-center gap-2 self-center sm:col-start-auto">
                            <span className={`size-2 rounded-full ${question.validationFlags?.length ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                            <span title="코드로 검사한 항목이며 경고가 없어도 원문 대조는 필요합니다" className="text-xs font-semibold tabular-nums text-muted-foreground">{question.validationFlags?.length ? `검토 ${question.validationFlags.length}건` : '경고 없음'}</span>
                            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                          </span>
                        </article>
                      ))}
                    </div>
                    <div className="border-t bg-muted/35 px-4 py-3 text-center text-xs text-muted-foreground">문항 텍스트와 추천 성취기준은 내보내기 전에 직접 수정할 수 있습니다</div>
                  </div>

                  {checkedQuestions[selected] && <QuestionInspector key={`${fileName}-${selected}`} question={checkedQuestions[selected]} catalog={standards} canMerge={selected > 0} recognizing={recognizingQuestion === checkedQuestions[selected].number} canRecognize={!busy && Boolean(checkedQuestions[selected].questionCaptures?.length)} canEditCapture={!busy && sourcePages.length > 0} onEditCapture={() => setEditingCapture(selected)} onTextChange={updateSelectedText} onStandardChange={updateSelectedStandard} onSubjectChange={updateSelectedSubject} onRefresh={refreshSelectedCandidates} onRecognize={() => void recognizeSelectedQuestion()} onSplit={splitSelectedQuestion} onMerge={mergeWithPrevious} />}
                </div>
              </TabsContent>

              <TabsContent value="standards" className="pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {questionData.map((question) => (
                    <article key={`${question.standardCode}-${question.number}`} className="rounded-2xl border bg-background p-5">
                      <div className="flex items-start justify-between gap-3"><Badge className="bg-primary/10 text-primary">{question.standardCode || '해당 없음'}</Badge><span className="text-xs font-semibold text-muted-foreground">검토용 추천</span></div>
                      <h2 className="mt-4 font-bold">{question.domain}</h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{question.standard}</p>
                      <p className="mt-4 text-xs font-semibold text-primary">연결 문항 {question.number}번</p>
                    </article>
                  ))}
                </div>
              </TabsContent>
            </Tabs>}
          </div>
        </div>
      </section>
      {exportOpen && <ExportDialog fileName={fileName} questions={questionData} onClose={() => setExportOpen(false)} />}
      {bankOpen && <QuestionBank onClose={() => setBankOpen(false)} />}
      {editingCapture !== null && questionData[editingCapture] && <CaptureEditor key={editingCapture} question={questionData[editingCapture]} sourcePages={sourcePages} onClose={() => setEditingCapture(null)} onSave={saveCaptureEdits} />}
      <footer className="mx-auto flex max-w-[1540px] flex-col gap-2 px-6 pb-8 text-xs leading-5 text-muted-foreground sm:flex-row sm:justify-between">
        <span className="text-sm font-medium">제작자: 여광재(온양고등학교)<br /><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/RuneDaeg/munhang-map/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT 라이선스</a></span>
        <span>성취기준 데이터: worksheet-grab · 2022 개정 교육과정</span>
        <span className="flex flex-wrap gap-x-4"><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/pblsketch/worksheet-grab/tree/090e24e331f779a2e329cf686c5c5444f9221ca9/data" target="_blank" rel="noreferrer">데이터 출처</a><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/jkf87/hwpx-skill" target="_blank" rel="noreferrer">HWPX 구현 참고</a><a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/KaTeX/KaTeX" target="_blank" rel="noreferrer">KaTeX</a></span>
      </footer>
    </main>
  );
}

function QuestionInspector({ question, catalog, canMerge, recognizing, canRecognize, canEditCapture, onEditCapture, onTextChange, onStandardChange, onSubjectChange, onRefresh, onRecognize, onSplit, onMerge }: {
  question: AnalyzedQuestion;
  catalog: StandardRecord[];
  canMerge: boolean;
  recognizing: boolean;
  canRecognize: boolean;
  canEditCapture: boolean;
  onEditCapture: () => void;
  onTextChange: (text: string) => void;
  onStandardChange: (code: string) => void;
  onSubjectChange: (subjectKey: string) => void;
  onRefresh: () => void;
  onRecognize: () => void;
  onSplit: (position: number) => void;
  onMerge: () => void;
}) {
  const textRef = useRef<QuestionEditorHandle>(null);
  const [cursor, setCursor] = useState(0);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const contentBlocks = useMemo(() => questionStructures(question.text), [question.text]);
  const boxCount = contentBlocks.filter((block) => block.kind === 'box').length;
  const tableCount = contentBlocks.filter((block) => block.kind === 'table').length;
  const allSubjects = useMemo(() => [...new Map(catalog.map((item) => [`${item.school}|${item.subject}`, `${item.school} · ${item.subject}`])).entries()], [catalog]);
  const subjectCandidates = question.subjectCandidates ?? [{ key: question.domain.replace(' · ', '|'), label: question.domain, confidence: question.confidence }];
  const standardCandidates = question.standardCandidates ?? [{ code: question.standardCode, standard: question.standard, domain: question.domain, confidence: question.confidence }];
  const selectedSubject = subjectCandidates.find((candidate) => candidate.label === question.domain)?.key ?? subjectCandidates[0]?.key ?? '';
  function insertLatex(value: string) {
    const position = textRef.current?.selectionStart ?? question.text.length;
    onTextChange(`${question.text.slice(0, position)}${value}${question.text.slice(position)}`);
    const nextPosition = position + value.length;
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(nextPosition, nextPosition);
      setCursor(nextPosition);
    });
  }
  return (
    <aside className="question-inspector overflow-hidden rounded-2xl border bg-background" aria-label={`${question.number}번 문항 정보`}>
      <div className="inspector-head shrink-0 p-5 text-white">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold text-white/80">{question.number}번 문항 정보</p><Badge className="bg-white/12 text-white">후보 {standardCandidates.length}개</Badge></div>
        <p className="mt-5 font-mono text-2xl font-bold tracking-tight text-accent">{question.standardCode}</p>
        <p className="mt-2 text-lg font-bold">{question.domain}</p>
      </div>
      {/* The scrollable region needs a tab stop for keyboard-only scrolling. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <section className="question-inspector-body p-5" tabIndex={0} aria-label={`${question.number}번 문항 상세 내용 · 스크롤 가능`}>
        {question.examSubject && <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">{question.examSubject.page}쪽 머리말에서 ‘{question.examSubject.label}’ 감지 · {question.selectedSubjectKey ? '직접 선택한 교과를 우선 반영' : '관련 교과 안에서 성취기준 추천'}</p>}
        {question.captureWarning && <output className="mb-3 block rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{question.captureWarning}</output>}
        {question.analysisWarning && <output className="mb-3 block rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{question.analysisWarning}</output>}
        {question.mappingReason && <p className="mb-3 rounded-lg bg-primary/5 px-3 py-2 text-sm">{question.mappingArea && <strong>{question.mappingArea} · </strong>}{question.mappingReason}</p>}
        {!!question.validationFlags?.length && <details className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><summary className="cursor-pointer font-medium">자동 검토 항목 {question.validationFlags.length}건</summary><ul className="mt-2 list-disc space-y-1 pl-5">{question.validationFlags.map(flag=><li key={flag.code}>{flag.message}</li>)}</ul></details>}
        {glyphWarning(question.text) && <output className="mb-3 block rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{glyphWarning(question.text)}</output>}
        <div className="mb-3 flex flex-wrap items-center gap-2"><Button variant="outline" disabled={!canEditCapture} onClick={onEditCapture}>캡처 범위 수정</Button>{question.captureReviewed && <Badge className="bg-emerald-100 text-emerald-800">범위 확인 완료</Badge>}</div>
        {question.questionCaptures?.map((capture, index) => (
          <figure key={`${capture.page}-${index}`} className="mb-4 overflow-hidden rounded-xl border">
            <figcaption className="bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">문항 전체 원문 캡처 · {capture.page}쪽{question.questionCaptures!.length > 1 ? ` · ${index + 1}/${question.questionCaptures!.length}` : ''} · 문서에 첨부됨</figcaption>
            <img src={capture.image} alt={`${question.number}번 문항의 발문, 그림자료, 선택지를 포함한 원문 캡처 ${index + 1}`} className="h-auto w-full bg-white object-contain" />
          </figure>
        ))}
        <div className="mb-5 rounded-xl border bg-muted/35 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-muted-foreground">문항 미리보기 · 수식·표·보기</p>
            <Badge variant="secondary">{boxCount || tableCount ? `상자 ${boxCount}개 · 표 ${tableCount}개` : '상자·표 구조 없음'}</Badge>
          </div>
          {contentBlocks.some((block) => block.kind === 'box' && block.inferred) && <p className="mb-2 text-xs text-muted-foreground">보기 제목과 항목·선택지 구분을 바탕으로 상자를 묶었습니다. 원문과 비교해 주세요.</p>}
          <Suspense fallback={<p className="text-sm text-muted-foreground">문항 미리보기를 불러오는 중…</p>}><MathText text={question.text} /></Suspense>
          {question.visualChoices?.length ? <div className="mt-4 space-y-3" aria-label="원본 그림 선택지">
            <p className="text-sm font-semibold">그림 선택지 · 원본 모양 보존</p>
            {question.visualChoices.map((choice,index)=><figure key={`${choice.page}-${choice.label}-${index}`} className="border bg-white p-2"><figcaption className="text-sm text-muted-foreground">{choice.label} 원본 선택지 · 문서에 첨부됨</figcaption><img src={choice.image} alt={`${choice.label} 선택지의 칸 배치와 숫자·수식을 보존한 원본`} className="h-auto max-w-full" /></figure>)}
          </div>:null}
        </div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">텍스트 편집 · 상자·표 표식은 위 미리보기에 적용됩니다</p>
        <QuestionTextEditor ref={textRef} value={question.text} onChange={onTextChange} onCursor={setCursor} />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted-foreground">LaTeX 삽입</span>
          <Button variant="outline" size="sm" onClick={() => insertLatex('$\\frac{a}{b}$')}>분수</Button>
          <Button variant="outline" size="sm" onClick={() => insertLatex('$x^{2}$')}>제곱</Button>
          <Button variant="outline" size="sm" onClick={() => insertLatex('$\\sqrt{x}$')}>루트</Button>
          <Button variant="outline" size="sm" onClick={() => insertLatex('$60\\,\\mathrm{km/h}$')}>단위</Button>
          <Button variant="outline" size="sm" disabled={recognizing || normalizeQuestionText(question.text) === question.text} onClick={() => onTextChange(normalizeQuestionText(question.text))}>텍스트 표기 정리</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">일반 문장은 평문으로, 실제 수식만 $…$로 입력하세요. ‘텍스트 표기 정리’는 불필요한 text 표기와 깨진 탭을 정리하며 API를 사용하지 않습니다.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => insertLatex('\n:::box 자료\n자료 내용을 입력하세요.\n:::\n')}>자료 상자 삽입</Button>
          <Button variant="outline" size="sm" onClick={() => insertLatex('\n:::box <보기>\nㄱ. 보기 내용\nㄴ. 보기 내용\n:::\n')}>보기 상자 삽입</Button>
          <Button variant="outline" size="sm" onClick={() => insertLatex('\n:::table\n| 구분 | 값 |\n| --- | --- |\n| A | 10 |\n| B | 20 |\n:::\n')}>자료표 삽입</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">로컬 추출이나 API 판독의 구조 정보로 자료 상자·보기를 한 칸 표로, 행·열 자료를 여러 칸 표로 만듭니다. 표식이 없어도 명확한 보기 목록은 자동으로 묶습니다. 위 미리보기에서 원문과 비교하세요. 편집칸의 :::는 상자 경계, |는 셀 구분이며 문서에는 실제 표로 저장됩니다.</p>
        <Button variant="outline" className="mt-3 w-full" disabled={!canRecognize} onClick={onRecognize}>
          {recognizing ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {recognizing ? '이 문항 API 판독 중…' : '이 문항만 API로 판독'}
        </Button>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">API 판독은 선택 사항입니다. 실행 전 문항 캡처·추출문 전송과 비용 가능성을 확인합니다. 문항 캡처가 없으면 먼저 캡처 범위를 지정하세요.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" disabled={cursor < 8 || cursor > question.text.length - 8} onClick={() => onSplit(cursor)}>커서에서 문항 나누기</Button>
          <Button variant="outline" size="sm" disabled={!canMerge} onClick={onMerge}>이전 문항과 합치기</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">경계가 틀리면 새 문항이 시작되는 위치에 커서를 놓고 나누세요.</p>
        {!question.questionCaptures?.length && question.figureImage && (
          <figure className="mt-4 overflow-hidden rounded-xl border">
            <figcaption className="bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">자동 감지한 문항 그림자료 · 문서에 첨부됨</figcaption>
            <img src={question.figureImage} alt={`${question.number}번 문항의 자동 감지 그림자료`} className="h-auto w-full bg-white object-contain" />
          </figure>
        )}
        {question.sourcePageImage && (
          <details className="mt-3 overflow-hidden rounded-xl border">
            <summary className="cursor-pointer bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">원문 페이지 펼쳐서 인식 결과 확인</summary>
            <img src={question.sourcePageImage} alt={`${question.number}번 문항이 포함된 PDF 원문 페이지`} className="h-auto w-full bg-white object-contain" />
          </details>
        )}
        <div className="my-5 h-px bg-border" />
        <div>
          <label htmlFor="question-subject" className="text-xs font-semibold text-muted-foreground">이 문항의 교과 후보</label>
          <NativeSelect id="question-subject" value={selectedSubject} onChange={(event) => { onSubjectChange(event.target.value); setShowAllSubjects(false); }} className="mt-2 w-full">
            {showAllSubjects ? allSubjects.map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>) : subjectCandidates.map((candidate) => <NativeSelectOption key={candidate.key} value={candidate.key}>{candidate.label}</NativeSelectOption>)}
          </NativeSelect>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setShowAllSubjects((value) => !value)}>{showAllSubjects ? '추천 교과만 보기' : '다른 교과 직접 선택'}</Button>
        </div>
        <div className="mt-5">
          <label htmlFor="question-standard" className="text-xs font-semibold text-muted-foreground">성취기준 후보</label>
          <NativeSelect id="question-standard" value={question.standardCode} onChange={(event) => onStandardChange(event.target.value)} className="mt-2 w-full">
            {standardCandidates.map((candidate) => <NativeSelectOption key={candidate.code} value={candidate.code}>{candidate.code}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <p className="mt-4 rounded-xl border border-primary/10 bg-primary/5 p-4 text-sm leading-6 text-foreground/80">{question.standard}</p>
        <Button variant="outline" className="mt-3 w-full" onClick={onRefresh}>수정한 문장으로 후보 다시 찾기 <ScanSearch /></Button>
      </section>
    </aside>
  );
}


function formatCompact(value: number) {
  return new Intl.NumberFormat('ko-KR', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
