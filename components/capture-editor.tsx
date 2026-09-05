'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cropPage, type QuestionCapture } from '@/lib/question-capture';
import { dragCaptureBox, setCaptureEdge, validCaptureBox, type DragMode, type Point } from '@/lib/capture-editor';
import type { CaptureBox } from '@/lib/pdf-layout';
import type { AnalyzedQuestion } from '@/lib/pdf-analysis';

type Region = { page: number; box: CaptureBox };

export function CaptureEditor({ question, sourcePages, onClose, onSave }: {
  question: AnalyzedQuestion;
  sourcePages: string[];
  onClose: () => void;
  onSave: (captures: QuestionCapture[]) => void;
}) {
  const initial: Region[] = question.questionCaptures?.length ? question.questionCaptures.map(({ page, box }) => ({ page, box: [...box] })) : [{ page: 1, box: [0.05, 0.1, 0.44, 0.3] }];
  const [regions, setRegions] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ origin: Point; box: CaptureBox; mode: DragMode; index: number } | null>(null);
  const region = regions[selected];
  const source = sourcePages[region.page - 1];
  const [x, y, w, h] = region.box;
  function update(box: CaptureBox) { setRegions((current) => current.map((item, i) => i === selected ? { ...item, box } : item)); }
  function point(event: PointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))];
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (saving || event.button !== 0) return;
    const origin = point(event);
    const mode = (event.target as SVGElement).dataset.handle as DragMode | undefined;
    drag.current = { origin, box: [...region.box], mode: mode ?? 'draw', index: selected };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    const box = dragCaptureBox(state.box, state.origin, point(event), state.mode);
    setRegions((current) => current.map((item, i) => i === state.index ? { ...item, box } : item));
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    const box = dragCaptureBox(state.box, state.origin, point(event), state.mode);
    setRegions((current) => current.map((item, i) => i === state.index ? { ...item, box: validCaptureBox(box) ? box : state.box } : item));
    drag.current = null;
  }
  async function save() {
    if (!regions.every((item) => validCaptureBox(item.box) && sourcePages[item.page - 1])) { setError('페이지와 캡처 영역을 확인해 주세요.'); return; }
    setSaving(true); setError('');
    try {
      const captures = await Promise.all(regions.map(async (item) => ({ ...item, image: await cropPage(sourcePages[item.page - 1], item.box) })));
      onSave(captures);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '캡처를 저장하지 못했습니다.'); setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="flex h-[92vh] max-w-[calc(100%-1rem)] flex-col gap-3 sm:max-w-5xl">
      <DialogTitle>{question.number}번 문항 캡처 범위 수정</DialogTitle>
      <DialogDescription>상자를 끌어 이동하고 모서리를 조절하세요. 상자 밖에서 드래그하면 새 범위를 그립니다. 위 발문부터 그림·자료와 마지막 선택지까지 포함해 주세요.</DialogDescription>
      <div className="grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 overflow-auto rounded-xl border bg-slate-100 p-2">
          <div className="relative w-full bg-white">
            {/* A local PDF image must not be sent to an image optimization server. */}
            {/* oxlint-disable-next-line next/no-img-element */}
            <img src={source} alt={`${region.page}쪽 원문. 오른쪽 입력란으로도 캡처 범위를 조절할 수 있습니다.`} className="block h-auto w-full select-none" draggable={false} />
            <svg className="absolute inset-0 h-full w-full touch-none select-none" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="드래그로 캡처 영역 조절" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { const state = drag.current; if (state) update(state.box); drag.current = null; }}>
              <title>드래그로 캡처 영역 조절</title>
              <path d={`M0,0 H1000 V1000 H0 Z M${x * 1000},${y * 1000} H${(x + w) * 1000} V${(y + h) * 1000} H${x * 1000} Z`} fill="rgba(15,23,42,.4)" fillRule="evenodd" />
              <rect x={x * 1000} y={y * 1000} width={w * 1000} height={h * 1000} fill="transparent" stroke="#0284c7" strokeWidth="3" vectorEffect="non-scaling-stroke" data-handle="move" className="cursor-move" />
              {([['nw', x, y], ['ne', x + w, y], ['sw', x, y + h], ['se', x + w, y + h]] as const).map(([corner, cx, cy]) => <rect key={corner} x={cx * 1000 - 10} y={cy * 1000 - 10} width="20" height="20" fill="white" stroke="#0284c7" strokeWidth="2" vectorEffect="non-scaling-stroke" data-handle={corner} className={corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'} />)}
            </svg>
          </div>
        </div>
        <fieldset disabled={saving} className="space-y-4">
          <div><label htmlFor="capture-part" className="text-sm font-semibold">캡처 조각</label><NativeSelect id="capture-part" value={selected} onChange={(event) => setSelected(Number(event.target.value))} className="mt-1 w-full">{regions.map((item, i) => <NativeSelectOption key={i} value={i}>{i + 1}번째 캡처 · {item.page}쪽</NativeSelectOption>)}</NativeSelect></div>
          <div><label htmlFor="capture-page" className="text-sm font-semibold">원문 페이지</label><NativeSelect id="capture-page" value={region.page} onChange={(event) => setRegions((current) => current.map((item, i) => i === selected ? { ...item, page: Number(event.target.value) } : item))} className="mt-1 w-full">{sourcePages.map((_image, i) => <NativeSelectOption key={i} value={i + 1}>{i + 1}쪽</NativeSelectOption>)}</NativeSelect></div>
          <div className="grid grid-cols-2 gap-2">{(['left', 'top', 'right', 'bottom'] as const).map((edge, i) => <div key={edge}><label htmlFor={`capture-${edge}`} className="text-sm">{['왼쪽', '위', '오른쪽', '아래'][i]} (%)</label><Input id={`capture-${edge}`} type="number" min="0" max="100" step="0.1" value={Number(([x, y, x + w, y + h][i] * 100).toFixed(1))} onChange={(event) => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) update(setCaptureEdge(region.box, edge, value / 100)); }} /></div>)}</div>
          <Button variant="outline" className="w-full" onClick={() => { setRegions((items) => [...items, { page: Math.min(sourcePages.length, region.page + 1), box: [0.05, 0.1, 0.44, 0.3] }]); setSelected(regions.length); }}>이어지는 캡처 추가</Button>
          <Button variant="outline" className="w-full" disabled={regions.length <= 1} onClick={() => { setRegions((items) => items.filter((_item, i) => i !== selected)); setSelected(0); }}>이 조각 삭제</Button>
          <Button variant="ghost" className="w-full" onClick={() => { setRegions(initial); setSelected(0); }}>수정 전 범위로 되돌리기</Button>
          <p className="text-sm leading-6 text-muted-foreground">저장하면 미리보기와 DOCX·HWPX 첨부에 반영됩니다. 문항 텍스트는 필요하면 저장 후 다시 판독하세요.</p>
        </fieldset>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={onClose} disabled={saving}>취소</Button><Button onClick={() => void save()} disabled={saving}>{saving ? '캡처 저장 중…' : '이 범위로 확정'}</Button></div>
    </DialogContent>
  </Dialog>;
}
