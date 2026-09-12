/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReleaseChecker, compareVersions } = require('../local/release-check.cjs');
const { checkReleaseVersion, compareReleaseVersion } = require('../lib/release-version.ts');
const page = 'https://github.com/RuneDaeg/munhang-map/releases';
const release = (version, overrides = {}) => ({ tag_name: `v${version}`, draft: false, prerelease: false,
  assets: [{ name: `munhang-map-local-${version}.zip`, state: 'uploaded', size: 100,
    browser_download_url: `${page}/download/v${version}/munhang-map-local-${version}.zip` }], ...overrides });

test('numeric versions compare correctly including equal, newer local and malformed values', () => {
  for (const compare of [compareVersions, compareReleaseVersion]) {
    assert.equal(compare('0.7.9', '0.7.10'), -1);
    assert.equal(compare('0.7.14', '0.7.14'), 0);
    assert.equal(compare('1.0.0', '0.99.999'), 1);
    assert.throws(() => compare('0.7.14-beta', '0.7.14'));
    assert.throws(() => compare('0.7.9007199254740992', '0.7.14'));
  }
});
test('selects the highest stable local release, not desktop, draft or prerelease', async () => {
  const check = createReleaseChecker(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/RuneDaeg/munhang-map/releases?per_page=100&page=1');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent', 'X-GitHub-Api-Version']);
    return Response.json([release('0.7.9'), release('0.7.10'), release('9.0.0', { prerelease: true }), release('8.0.0', { draft: true }), release('7.0.0', { tag_name: 'desktop-v7.0.0' }), release('0.7.8')]);
  });
  const result = await check();
  assert.equal(result.version, '0.7.10');
  assert.equal(result.downloadUrl, `${page}/download/v0.7.10/munhang-map-local-0.7.10.zip`);
});
test('pagination uses the fixed repository, ignores hostile links, and remains bounded', async () => {
  const requests = [];
  const result = await createReleaseChecker(async url => {
    requests.push(url);
    return requests.length === 1 ? Response.json([release('0.7.10')], { headers: { Link: '<https://evil.example/settings>; rel="next"' } }) : Response.json([release('0.7.14')]);
  })();
  assert.equal(result.version, '0.7.14');
  assert.equal(requests[1], 'https://api.github.com/repos/RuneDaeg/munhang-map/releases?per_page=100&page=2');
  let calls = 0;
  await assert.rejects(createReleaseChecker(async () => { calls++; return Response.json([], { headers: { Link: '<next>; rel="next"' } }); })(), /완료하지 못/);
  assert.equal(calls, 5);
});
test('latest release with missing, unfinished or hostile asset never offers an old ZIP or source archive', async () => {
  for (const assets of [[], [{ ...release('0.7.14').assets[0], state: 'new' }], [{ ...release('0.7.14').assets[0], browser_download_url: 'https://evil.example/file.zip' }]]) {
    const data = await createReleaseChecker(async () => Response.json([release('0.7.14', { assets, zipball_url: 'https://evil.example/source' }), release('0.7.13')]))();
    assert.equal(data.version, '0.7.14'); assert.equal(data.downloadUrl, null);
    assert.equal(data.releaseUrl, `${page}/tag/v0.7.14`);
  }
});
test('manual checks deduplicate in-flight work and reuse a short memory cache', async () => {
  let finish, calls = 0, clock = 100000;
  const check = createReleaseChecker(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => clock);
  assert.equal(calls, 0);
  const a = check(), b = check(); assert.equal(calls, 1);
  finish(Response.json([release('0.7.14')]));
  assert.deepEqual(await a, await b); await check(); assert.equal(calls, 1);
  clock += 61000; const c = check(); assert.equal(calls, 2); finish(Response.json([release('0.7.15')]));
  assert.equal((await c).version, '0.7.15');
});
test('404, offline, bad JSON, limits and oversized responses cannot claim latest', async () => {
  for (const [response, message] of [[new Response('', { status: 404 }), /접근/], [new Response('', { status: 500 }), /응답 오류/], [Response.json({}), /목록 형식/], [Response.json([]), /찾지 못/], [new Response('{bad', { headers: { 'content-type': 'application/json' } }), /읽지 못/], [new Response('x'.repeat(3000001), { headers: { 'content-type': 'application/json' } }), /너무 커/]]) {
    await assert.rejects(createReleaseChecker(async () => response)(), message);
  }
  await assert.rejects(createReleaseChecker(async () => { throw new TypeError('offline'); })(), /연결/);
  let calls = 0;
  const limited = createReleaseChecker(async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); });
  await assert.rejects(limited(), /제한/); await assert.rejects(limited(), /이후/); assert.equal(calls, 1);
});
test('timeout aborts the request and returns a recoverable error', async t => {
  const original = global.setTimeout;
  t.after(() => { global.setTimeout = original; });
  global.setTimeout = callback => original(callback, 5);
  await assert.rejects(createReleaseChecker((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))(), /시간이 초과/);
});
test('client sends only an empty manual POST and validates returned links', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const result = { version: '0.7.14', checkedAt: new Date().toISOString(), releaseUrl: `${page}/tag/v0.7.14`, downloadUrl: null };
  global.fetch = async (url, options) => {
    assert.equal(url, '/api/version-check'); assert.equal(options.method, 'POST'); assert.equal(options.body, '{}');
    return Response.json(result);
  };
  assert.deepEqual(await checkReleaseVersion(), result);
  global.fetch = async () => Response.json({ ...result, downloadUrl: 'https://evil.example/zip' });
  await assert.rejects(checkReleaseVersion(), /올바르지/);
  global.fetch = async () => new Response('<html>old server</html>');
  await assert.rejects(checkReleaseVersion(), /지원하지/);
});
test('version control renders without making an automatic request', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { VersionCheck } = require('../components/version-check.tsx');
  const html = renderToStaticMarkup(React.createElement(VersionCheck, { current: '0.7.14' }));
  assert.match(html, /버전 확인/);
});
