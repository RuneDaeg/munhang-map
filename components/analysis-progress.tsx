'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import type { AnalysisProgress as ProgressState } from '@/lib/analysis-workflow';

const stages = [['pdf', 'PDF 읽기·수식 복원'], ['capture', '문항 분리·캡처'], ['classify', '성취기준 추천']] as const;

export function AnalysisProgress({ progress, detail }: { progress: ProgressState | null; detail?: string }) {
  const active = stages.findIndex(([key]) => key === progress?.stage);
  return <section className="grid min-h-[400px] content-center gap-6 rounded-2xl border bg-primary/5 p-6 sm:p-10" aria-busy="true">
    <div className="flex items-center gap-3"><LoaderCircle className="size-7 animate-spin text-primary" /><h2 className="text-xl font-bold">분석 진행 중…</h2></div>
    <output aria-live="polite" className="text-base">{detail || progress?.detail || '저장한 문항을 불러오는 중'}</output>
    <Progress value={progress?.percent ?? null}><ProgressLabel>전체 작업 진행률</ProgressLabel>{progress && <ProgressValue />}</Progress>
    {progress && <ol className="grid gap-3 sm:grid-cols-3">{stages.map(([key, label], index) => <li key={key} className={`flex items-center gap-2 text-sm ${index === active ? 'font-bold text-primary' : 'text-muted-foreground'}`}><span className="grid size-6 shrink-0 place-items-center rounded-full border bg-background">{index < active ? <Check className="size-4" /> : index + 1}</span>{label}</li>)}</ol>}
    <p className="text-sm leading-6 text-muted-foreground">API 없이 이 컴퓨터에서 분석합니다. 문항 분리·수식 복원·캡처·성취기준 추천을 마치면 결과를 표시합니다. 이후 필요한 문항에서만 API 판독을 실행할 수 있습니다.</p>
  </section>;
}
