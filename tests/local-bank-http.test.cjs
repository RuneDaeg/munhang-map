/* oxlint-disable typescript/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');

test('local HTTP bank saves, reloads after a process restart, and rejects cross-origin access', { timeout: 25000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-http-test-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function start() {
    const child = spawn(process.execPath, [process.env.MUNHANG_TEST_SERVER || path.join(__dirname, '../local/server.cjs')], { env: { ...process.env, MUNHANG_DATA_DIR: root, MUNHANG_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('local server did not start')), 8000);
      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('local server exited before ready')); });
    });
    return { child, origin };
  }
  const first = await start();
  const post = (origin, route, body, requestOrigin = origin) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(body) });
  assert.deepEqual((await (await fetch(`${first.origin}/api/question-bank`)).json()).items, []);
  const input = { sourceFileName: 'fixture.pdf', sourceFingerprint: 'b'.repeat(64), questions: [{ number: 1, text: '테스트 문항', type: 'test', standardCode: '[test]', standard: '성취기준', domain: '통합과학', confidence: 80, questionCaptures: [{ page: 1, box: [0, 0, 0.5, 0.5], image: 'data:image/jpeg;base64,/9j/2Q==' }] }] };
  assert.equal((await post(first.origin, '/api/question-bank', input, 'https://untrusted.example')).status, 400);
  // Fetch normalizes Host; raw HTTP is needed to test a forged Host header.
  const forgedHostStatus = await new Promise((resolve, reject) => {
    http.get(`${first.origin}/api/question-bank`, { headers: { Host: 'untrusted.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(forgedHostStatus, 400);
  assert.equal((await fetch(`${first.origin}/api/question-bank`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
  const save = await post(first.origin, '/api/question-bank', input);
  assert.equal(save.status, 200); assert.equal((await save.json()).saved, 1);
  assert.equal((await fetch(`${first.origin}/`)).status, 200);
  assert.match((await fetch(`${first.origin}/pdf.worker.min.mjs`, { method: 'HEAD' })).headers.get('content-type'), /javascript/);
  const exited = once(first.child, 'exit'); first.child.kill('SIGTERM'); await exited;
  const second = await start();
  const items = (await (await fetch(`${second.origin}/api/question-bank`)).json()).items;
  assert.equal(items.length, 1);
  const selected = await post(second.origin, '/api/question-bank/selection', { ids: [items[0].id] });
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).questions[0].sourceFileName, 'fixture.pdf');
});
