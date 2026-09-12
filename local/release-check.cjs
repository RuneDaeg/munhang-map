/* oxlint-disable typescript/no-require-imports */
const RELEASES_API = 'https://api.github.com/repos/RuneDaeg/munhang-map/releases';
const RELEASES_PAGE = 'https://github.com/RuneDaeg/munhang-map/releases';

function versionParts(value) {
  const match = typeof value === 'string' && /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw new Error('버전 번호를 비교할 수 없습니다.');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

// No credentials, request payloads, document data, or caller-controlled URLs.
// A bounded full listing avoids confusing desktop-v* or prereleases with v*.
function createReleaseChecker(fetcher = fetch, now = Date.now) {
  let pending, cached, retryAt = 0;
  async function read() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const releases = [];
      for (let page = 1; page <= 5; page++) {
        const response = await fetcher(`${RELEASES_API}?per_page=100&page=${page}`, {
          method: 'GET', redirect: 'error', credentials: 'omit', signal: controller.signal,
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'munhang-map-release-check', 'X-GitHub-Api-Version': '2022-11-28' },
        });
        if (response.status === 403 || response.status === 429) {
          const after = Number(response.headers.get('retry-after'));
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          retryAt = Math.max(now() + 60000, Number.isFinite(after) && after > 0 ? now() + Math.min(after, 86400) * 1000 : 0,
            Number.isFinite(reset) && reset > now() ? Math.min(reset, now() + 86400000) : 0);
          throw new Error('GitHub 요청이 제한되었거나 접근이 거부되었습니다. 잠시 후 다시 확인해 주세요.');
        }
        if (response.status === 404) throw new Error('공개 릴리스 정보를 찾거나 접근할 수 없습니다.');
        if (!response.ok) throw new Error('GitHub 응답 오류로 최신 버전을 확인하지 못했습니다.');
        if (!response.headers.get('content-type')?.includes('json')) throw new Error('릴리스 응답 형식이 올바르지 않습니다.');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('릴리스 응답이 비어 있습니다.');
        const decoder = new TextDecoder();
        let body = '', size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 3000000) { await reader.cancel(); throw new Error('릴리스 응답이 너무 커 최신 여부를 확인하지 못했습니다.'); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        const rows = JSON.parse(body);
        if (!Array.isArray(rows) || rows.length > 100) throw new Error('릴리스 목록 형식이 올바르지 않습니다.');
        releases.push(...rows);
        // Do not follow an upstream Link URL. Only request our fixed repository.
        const more = /rel="next"/.test(response.headers.get('link') || '');
        if (!more) break;
        if (page === 5) throw new Error('릴리스 목록이 많아 최신 여부 확인을 완료하지 못했습니다. GitHub에서 확인해 주세요.');
      }
      const candidates = releases.filter(r => r && r.draft === false && r.prerelease === false && typeof r.tag_name === 'string' && r.tag_name.startsWith('v') && versionParts(r.tag_name));
      candidates.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
      const latest = candidates[0];
      if (!latest) throw new Error('공개된 정식 로컬 버전을 찾지 못했습니다.');
      const version = latest.tag_name.slice(1);
      const filename = `munhang-map-local-${version}.zip`;
      const downloadUrl = `${RELEASES_PAGE}/download/v${version}/${filename}`;
      const asset = Array.isArray(latest.assets) && latest.assets.find(a => a?.name === filename && a.state === 'uploaded' && a.size > 0 && a.browser_download_url === downloadUrl);
      return { version, releaseUrl: `${RELEASES_PAGE}/tag/v${version}`, downloadUrl: asset ? downloadUrl : null,
        checkedAt: new Date(now()).toISOString() };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('버전 확인 시간이 초과되었습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('GitHub에 연결하거나 릴리스 정보를 읽지 못했습니다. 인터넷 연결을 확인해 주세요.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return async () => {
    if (retryAt > now()) throw new Error(`GitHub 요청 제한으로 ${new Date(retryAt).toLocaleTimeString('ko-KR')} 이후 다시 확인해 주세요.`);
    if (cached && now() - Date.parse(cached.checkedAt) < 60000) return cached;
    if (!pending) pending = read().then(result => { cached = result; return result; }).finally(() => { pending = undefined; });
    return pending;
  };
}
module.exports = { createReleaseChecker, compareVersions, versionParts };
