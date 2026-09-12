export const releasesPage = 'https://github.com/RuneDaeg/munhang-map/releases';
export type ReleaseVersion = { version: string; releaseUrl: string; downloadUrl: string | null; checkedAt: string };
function parts(value: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('버전 번호를 비교할 수 없습니다.');
  const numbers = value.split('.').map(Number);
  if (!numbers.every(Number.isSafeInteger)) throw new Error('버전 번호가 올바르지 않습니다.');
  return numbers;
}
export function compareReleaseVersion(current: string, latest: string) {
  const a = parts(current), b = parts(latest);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export async function checkReleaseVersion(): Promise<ReleaseVersion> {
  const response = await fetch('/api/version-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('이 실행 환경은 버전 확인을 지원하지 않습니다. GitHub 릴리스에서 확인해 주세요.');
  const value = await response.json();
  if (!value || typeof value !== 'object') throw new Error('릴리스 정보가 올바르지 않습니다.');
  const data = value as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '버전을 확인하지 못했습니다.');
  if (typeof data.version !== 'string' || typeof data.checkedAt !== 'string') throw new Error('릴리스 정보가 올바르지 않습니다.');
  parts(data.version);
  const releaseUrl = `${releasesPage}/tag/v${data.version}`;
  const downloadUrl = `${releasesPage}/download/v${data.version}/munhang-map-local-${data.version}.zip`;
  if (data.releaseUrl !== releaseUrl || (data.downloadUrl !== null && data.downloadUrl !== downloadUrl) || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('릴리스 정보가 올바르지 않습니다.');
  return { version: data.version, releaseUrl, downloadUrl: data.downloadUrl, checkedAt: data.checkedAt };
}
