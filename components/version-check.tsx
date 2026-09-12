'use client';
import { useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { checkReleaseVersion, compareReleaseVersion, releasesPage, type ReleaseVersion } from '../lib/release-version';

export function VersionCheck({ current }: { current: string }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false);
  const [release, setRelease] = useState<ReleaseVersion | null>(null), [error, setError] = useState('');
  const running = useRef(false);
  async function check() {
    setOpen(true);
    if (running.current) return;
    running.current = true; setLoading(true); setError(''); setRelease(null);
    try { const found = await checkReleaseVersion(); compareReleaseVersion(current, found.version); setRelease(found); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '버전을 확인하지 못했습니다.'); }
    finally { running.current = false; setLoading(false); }
  }
  const comparison = release ? compareReleaseVersion(current, release.version) : null;
  return <>
    <Button variant="outline" size="sm" onClick={() => void check()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}버전 확인</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>문항맵 버전 확인</DialogTitle>
        <DialogDescription>현재 실행 중: v{current}. 버튼을 누를 때만 GitHub 공개 릴리스를 확인합니다. 시험지·문항·API 키는 전송하지 않습니다.</DialogDescription>
        {loading && <output className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />GitHub 릴리스 확인 중…</output>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {release && <div className="space-y-3 text-sm leading-6">
          <p className="font-semibold">{comparison === 0 ? '최신 정식 버전과 같습니다.' : comparison === -1 ? '새 버전이 있습니다.' : '공개 정식판보다 새로운 로컬 버전을 사용 중입니다. 이전 버전으로 바꿀 필요는 없습니다.'}</p>
          <p>GitHub 정식 버전: v{release.version}</p>
          {!release.downloadUrl && <p className="text-amber-800">이 릴리스의 실행용 ZIP은 아직 준비되지 않았습니다.</p>}
          <p className="text-muted-foreground">확인 시각: {new Date(release.checkedAt).toLocaleString('ko-KR')} · 1분 이내 재확인은 같은 결과를 사용합니다.</p>
          {comparison === -1 && release.downloadUrl && <a href={release.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-primary underline">새 버전 ZIP 받기<ExternalLink className="size-4" /></a>}
          <p>자동 설치하거나 실행 중인 파일을 덮어쓰지 않습니다. 현재 검토 결과를 저장한 뒤 새 ZIP을 별도 폴더에 풀어 실행하세요. 같은 컴퓨터의 문제함과 API 설정은 유지됩니다.</p>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={release?.releaseUrl || releasesPage} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">GitHub 릴리스 열기</a>
          <Button variant="outline" disabled={loading} onClick={() => void check()}>다시 확인</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
