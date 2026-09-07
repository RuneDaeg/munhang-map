'use client';

import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { downloadDocx, downloadHwpx, downloadStandardArchive, groupQuestionsByStandard } from '@/lib/document-export';
import type { AnalyzedQuestion } from '@/lib/pdf-analysis';

export function ExportDialog({ fileName, questions, onClose }: { fileName: string; questions: AnalyzedQuestion[]; onClose: () => void }) {
  const [grouped, setGrouped] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  async function save(format: 'docx' | 'hwpx') {
    setExporting(true); setError(''); setProgress('문서 준비 중…');
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (grouped) await downloadStandardArchive(fileName, questions, format, (completed, total) => setProgress(`성취기준별 문서 생성 · ${completed}/${total}개`));
      else if (format === 'docx') downloadDocx(fileName, questions);
      else await downloadHwpx(fileName, questions);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '문서를 만들지 못했습니다.'); }
    finally { setExporting(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !exporting) onClose(); }}>
    <DialogContent className="sm:max-w-lg" showCloseButton={!exporting}>
      <DialogTitle>문서 내보내기</DialogTitle>
      <DialogDescription>총 {questions.length}문항 · 성취기준 {groupQuestionsByStandard(questions).length}개. 화면에서 선택·수정한 성취기준으로 묶습니다. 문항 전체 캡처도 포함됩니다.</DialogDescription>
      <label htmlFor="export-grouping" className="text-sm font-semibold">파일 구성</label>
      <NativeSelect id="export-grouping" disabled={exporting} value={grouped ? 'standard' : 'single'} onChange={(event) => setGrouped(event.target.value === 'standard')} className="w-full">
        <NativeSelectOption value="standard">성취기준마다 파일 분리 · ZIP으로 받기</NativeSelectOption>
        <NativeSelectOption value="single">모든 문항을 문서 하나로 받기</NativeSelectOption>
      </NativeSelect>
      <p className="text-sm leading-6 text-muted-foreground">ZIP에는 성취기준별 문서와 원본 PDF·문항 번호를 정리한 목록이 들어갑니다. 미분류 문항은 별도 파일로 보존됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        <Button disabled={exporting || !questions.length} onClick={() => void save('docx')}><Download /> Word · DOCX</Button>
        <Button variant="outline" disabled={exporting || !questions.length} onClick={() => void save('hwpx')}><Download /> 한글 · HWPX</Button>
      </div>
      {exporting && <output className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{progress}</output>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm text-muted-foreground">수식은 LaTeX 원문과 원문 캡처로 보존됩니다. 네이티브 편집 수식 변환은 아직 지원하지 않습니다.</p>
    </DialogContent>
  </Dialog>;
}
