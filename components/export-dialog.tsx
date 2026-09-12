'use client';

import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { captureExportSummary, downloadCaptureArchive, downloadDocx, downloadHwpx, downloadStandardArchive, groupQuestionsByStandard } from '@/lib/document-export';
import type { AnalyzedQuestion } from '@/lib/pdf-analysis';

export function ExportDialog({ fileName, questions, onClose }: { fileName: string; questions: AnalyzedQuestion[]; onClose: () => void }) {
  const [grouped, setGrouped] = useState(true);
  const [capturesGrouped, setCapturesGrouped] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const captures = captureExportSummary(questions, fileName);
  async function save(format: 'docx' | 'hwpx' | 'images') {
    if (exporting) return;
    setExporting(true); setError(''); setProgress(format === 'images' ? '캡처 이미지 준비 중…' : '문서 준비 중…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (format === 'images') await downloadCaptureArchive(fileName, questions, (completed, total) => setProgress(`캡처 이미지 묶는 중 · ${completed}/${total}장`), { groupByStandard: capturesGrouped });
      else if (grouped) await downloadStandardArchive(fileName, questions, format, (completed, total) => setProgress(`성취기준별 문서 생성 · ${completed}/${total}개`));
      else if (format === 'docx') downloadDocx(fileName, questions);
      else await downloadHwpx(fileName, questions);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '내보내기 파일을 만들지 못했습니다.'); }
    finally { setExporting(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !exporting) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!exporting}>
      <DialogTitle>문항 내보내기</DialogTitle>
      <DialogDescription>총 {questions.length}문항 · 성취기준 {groupQuestionsByStandard(questions).length}개. 캡처 이미지만 받거나, 수정한 텍스트·성취기준·캡처가 포함된 문서를 받으세요.</DialogDescription>
      <section aria-labelledby="capture-export-heading" className="space-y-3 rounded-xl border bg-muted/40 p-4">
        <h3 id="capture-export-heading" className="font-semibold">캡처 이미지만 받기 · {captures.imageCount}장</h3>
        <p className="text-sm leading-6 text-muted-foreground">문항 전체 캡처를 원본 화질 그대로 ZIP에 담습니다. 파일명에 PDF 이름·문항 번호·쪽수가 들어가며, 여러 장인 문항은 순서대로 모두 저장합니다. 이미지에 글자를 덧붙이거나 API를 다시 호출하지 않습니다.</p>
        <label htmlFor="capture-export-grouping" className="block text-sm font-semibold">캡처 이미지 구성</label>
        <NativeSelect id="capture-export-grouping" disabled={exporting} value={capturesGrouped ? 'standard' : 'single'} onChange={(event) => setCapturesGrouped(event.target.value === 'standard')} className="w-full">
          <NativeSelectOption value="standard">성취기준별 폴더 + 매핑 목록 · ZIP</NativeSelectOption>
          <NativeSelectOption value="single">이미지만 한 폴더 · ZIP</NativeSelectOption>
        </NativeSelect>
        <p className="text-sm leading-6 text-muted-foreground">{capturesGrouped ? '현재 선택된 성취기준별로 폴더를 나누고, 문항목록.csv에 이미지 경로·성취기준 코드와 내용·교과·원본 PDF·문항 번호·캡처 순번·쪽수를 함께 담습니다. 내 문제함에서는 저장된 매핑을 사용하며, 미분류 문항도 별도 폴더에 보존합니다. 새로 매핑하지 않으므로 내보내기 전에 분류를 확인하세요.' : '폴더를 나누지 않고 이미지만 담습니다. 성취기준·매핑 목록·추출 텍스트 문서는 포함하지 않습니다.'}</p>
        {captures.missing.length > 0 && <p className="break-words text-sm text-destructive">캡처가 없는 문항 {captures.missing.length}개: {captures.missingLabels}{captures.missing.length > 5 ? ' 외' : ''}. 원본 PDF·검토 파일에서 캡처를 확인하거나 내 문제함에서 캡처가 있는 문항만 선택해 주세요.</p>}
        {captures.reviewCount > 0 && <p className="text-sm text-amber-800">캡처 범위 확인이 필요한 문항 {captures.reviewCount}개도 현재 범위 그대로 포함됩니다. 필요하면 먼저 ‘캡처 범위 수정’을 해 주세요.</p>}
        <Button variant="outline" className="w-full" disabled={exporting || !captures.imageCount || captures.missing.length > 0} onClick={() => void save('images')}><Download /> {capturesGrouped ? '성취기준별 캡처 · ZIP' : '캡처 이미지만 · ZIP'}</Button>
      </section>
      <label htmlFor="export-grouping" className="text-sm font-semibold">DOCX/HWPX 파일 구성</label>
      <NativeSelect id="export-grouping" disabled={exporting} value={grouped ? 'standard' : 'single'} onChange={(event) => setGrouped(event.target.value === 'standard')} className="w-full">
        <NativeSelectOption value="standard">성취기준마다 파일 분리 · ZIP으로 받기</NativeSelectOption>
        <NativeSelectOption value="single">모든 문항을 문서 하나로 받기</NativeSelectOption>
      </NativeSelect>
      <p className="text-sm leading-6 text-muted-foreground">ZIP에는 성취기준별 문서와 원본 PDF·문항 번호를 정리한 목록이 들어갑니다. 미분류 문항은 별도 파일로 보존됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        <Button disabled={exporting || !questions.length} onClick={() => void save('docx')}><Download /> Word · DOCX</Button>
        <Button variant="outline" disabled={exporting || !questions.length} onClick={() => void save('hwpx')}><Download /> 한글 · HWPX</Button>
      </div>
      {exporting && <output aria-live="polite" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{progress}</output>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm leading-6 text-muted-foreground">DOCX/HWPX는 지원되는 수식을 각 문서의 편집 가능한 수식으로 변환하고 원문 캡처도 첨부합니다. 변환할 수 없는 수식은 문항 번호와 오류를 표시하고 해당 문서 내보내기를 중단합니다. 캡처 이미지 내보내기에는 수식 변환이 필요하지 않습니다.</p>
    </DialogContent>
  </Dialog>;
}
