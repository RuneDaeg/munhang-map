'use client';

import { useState } from 'react';
import { Download, Mail } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import type { AnalyzedQuestion } from '../lib/pdf-analysis';
import { serializeReview } from '../lib/review-file';
import { buildSupportEml, buildSupportMailto, SUPPORT_ATTACHMENT_NAME, SUPPORT_EMAIL } from '../lib/support-report';

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function SupportReport({ version, fileName, questions, sourcePages, busy }: {
  version: string; fileName: string; questions: AnalyzedQuestion[]; sourcePages: string[]; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState<{ questions: AnalyzedQuestion[]; sourcePages: string[]; fileName: string } | null>(null);
  const [details, setDetails] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const consent = consented?.questions === questions && consented.sourcePages === sourcePages && consented.fileName === fileName;
  function changeOpen(next: boolean) {
    setOpen(next); setConsented(null); setPrepared(false); setMessage(''); setError('');
  }
  const hwpx = questions.length > 0 && questions.every(question => question.sourceFormat === 'hwpx' && /^[a-f0-9]{64}$/.test(question.sourceFingerprint ?? ''));
  const available = (sourcePages.length > 0 || hwpx) && questions.length > 0 && !busy;
  const enabled = available && consent;

  function prepare(kind: 'json' | 'eml') {
    if (!enabled) return;
    setError('');
    try {
      const json = serializeReview(fileName, questions, sourcePages);
      const content = kind === 'eml' ? buildSupportEml(version, json, details) : json;
      download(content, kind === 'eml' ? 'munhang-map-report.eml' : SUPPORT_ATTACHMENT_NAME,
        kind === 'eml' ? 'message/rfc822' : 'application/json');
      if (kind === 'json') setPrepared(true);
      const size = (new Blob([content]).size / 1024 / 1024).toFixed(1);
      setMessage(`${size} MB 파일 다운로드를 요청했습니다. 다운로드 폴더를 확인하세요. 아직 메일은 발송되지 않았습니다.${Number(size) >= 20 ? ' 파일이 큽니다. 메일 서비스의 첨부 용량 제한을 확인하세요.' : ''}`);
    } catch {
      setError('제보 파일을 만들지 못했습니다. 문항 분석이 끝났는지 확인하고 다시 시도해 주세요.');
    }
  }

  return <>
    <Button variant="ghost" size="sm" onClick={() => changeOpen(true)}><Mail />인식 오류 제보</Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>제작자에게 인식 오류 제보</DialogTitle>
        <DialogDescription>받는 주소: <span className="select-all font-semibold">{SUPPORT_EMAIL}</span><br />검토 JSON을 첨부해 원문과 추출 결과를 함께 확인할 수 있습니다. 자동 발송 기능은 아닙니다.</DialogDescription>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <p className="font-semibold">검토 JSON에는 원본 PDF의 모든 페이지 이미지 또는 HWPX 삽입 그림과 현재 문항·정답·해설·성취기준·수정 내용이 포함됩니다.</p>
          <p>API 키와 연결 설정은 포함하지 않습니다. 미공개 시험지·개인정보·외부 반출 금지 자료는 보내지 마세요. 메일을 보내면 제작자와 이용하는 메일 서비스에 자료가 전달됩니다.</p>
        </div>
        <p className="break-all text-sm">{available ? `현재 파일: ${fileName} · ${questions.length}문항 · ${hwpx ? 'HWPX 구조 추출' : `${sourcePages.length}쪽`} · v${version}` : busy ? '분석·판독이 끝난 뒤 제보 파일을 준비할 수 있습니다.' : '먼저 PDF/HWPX를 분석하거나 검토 JSON 파일을 열어 주세요. 예시 문항은 제보 파일에 포함하지 않습니다.'}</p>
        <label className="grid gap-2 text-sm font-medium">문제 문항 번호와 오류 설명 (선택)
          <textarea value={details} maxLength={4000} onChange={event => setDetails(event.target.value)} rows={3} placeholder="예: 13번 사료 상자의 테두리가 빠집니다." className="w-full rounded-lg border bg-background p-3 font-normal" />
        </label>
        <label className="flex items-start gap-2 text-sm leading-6">
          <input type="checkbox" checked={consent} disabled={!available} onChange={event => { setConsented(event.target.checked ? { questions, sourcePages, fileName } : null); setPrepared(false); }} className="mt-1.5" />
          <span>첨부 내용과 외부 공유 권한을 확인했으며, 반출 금지 자료·개인정보가 포함되지 않았습니다.</span>
        </label>
        <div className="space-y-3 rounded-lg border p-3 text-sm">
          <p className="font-semibold">방법 1 · JSON을 받아 직접 첨부</p>
          <Button variant="outline" disabled={!enabled} onClick={() => prepare('json')}><Download />1. 검토 JSON 받기</Button>
          {prepared && enabled && <a className="block font-semibold text-primary underline underline-offset-4" href={buildSupportMailto(version, SUPPORT_ATTACHMENT_NAME, details)}>2. 메일 작성 열기</a>}
          <p className="text-muted-foreground">기본 메일 앱에서 다운로드한 {SUPPORT_ATTACHMENT_NAME}을 직접 첨부하고 보내세요. 웹메일을 쓴다면 위 주소를 복사해 새 메일을 작성하세요. 링크만으로 첨부파일이 자동 추가되지는 않습니다.</p>
        </div>
        <div className="space-y-3 rounded-lg border p-3 text-sm">
          <p className="font-semibold">방법 2 · JSON이 첨부된 메일 초안</p>
          <Button variant="outline" disabled={!enabled} onClick={() => prepare('eml')}><Download />첨부된 메일 초안(.eml) 받기</Button>
          <p className="text-muted-foreground">.eml을 지원하는 메일 앱에서 열어 발신 계정·받는 주소·첨부를 확인한 뒤 보내세요. 읽기 전용으로 열리거나 지원하지 않으면 방법 1을 사용하세요.</p>
        </div>
        {message && <output className="text-sm leading-6">{message}</output>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
