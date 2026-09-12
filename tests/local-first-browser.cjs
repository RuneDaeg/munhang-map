/* oxlint-disable typescript/no-require-imports */
// Optional end-to-end release test. PDFs and screenshots stay outside git.
// All API status/recognition requests are mocked; external requests are blocked.
// MUNHANG_TEST_PDFS='[{"path":"/absolute/exam.pdf","count":25}]'
// MUNHANG_TEST_SERVER=/absolute/unpacked/server.cjs node tests/local-first-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium, expect } = require(process.env.MUNHANG_PLAYWRIGHT_MODULE || 'playwright/test');

async function main() {
  const inputs = JSON.parse(process.env.MUNHANG_TEST_PDFS || '[]');
  assert(inputs.length, 'Provide authorized sample PDFs with expected question counts');
  for (const input of inputs) {
    assert(path.isAbsolute(input.path) && fs.statSync(input.path).isFile());
    assert(Number.isInteger(input.count) && input.count > 1);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-local-first-'));
  const result = { status: 'RUNNING', initialUploads: [], cancelledRequests: 0, acceptedRequests: [], externalRequests: [], errors: [] };
  const child = spawn(process.execPath, [process.env.MUNHANG_TEST_SERVER || path.join(__dirname, '../local/server.cjs')], {
    env: { ...process.env, MUNHANG_DATA_DIR: path.join(temporary, 'data'), MUNHANG_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000);
      let stdout = '';
      child.stdout.on('data', data => {
        stdout += data;
        const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited before ready')); });
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    let available = true, pendingResponse, autoRespond = false, failureNumber = null;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        result.externalRequests.push(url.origin);
        return route.abort();
      }
      if (url.pathname === '/api/recognize') {
        if (request.method() === 'GET') return route.fulfill({ json: {
          available, local: true, providerLabel: '검증용 연결', model: 'mock-vision', keyHint: 'mock-****',
          usage: { requests: result.acceptedRequests.length, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
        } });
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON();
        assert.equal(body.questions.length, 1, 'Manual action must send exactly one question');
        assert.match(body.image, /^data:image\/(?:jpeg|png);base64,/);
        result.acceptedRequests.push(body.questions.map(question => question.number));
        // Hold selected requests to exercise stop/edit races; no real provider call.
        if (!autoRespond) await new Promise(resolve => { pendingResponse = resolve; });
        const question = body.questions[0];
        if (question.number === failureNumber) return route.fulfill({ json: { error: '모의 공급자 실패 — 재요청 금지' } });
        return route.fulfill({ json: { questions: [{
          number: question.number,
          latexText: question.text.replace(/^시험지 상단 과목:[^\n]*\n/, ''),
          indirectStem: '', directStem: '', choices: [], hasFigure: false,
          figureBox: null, questionBox: [0, 0, 1, 1],
        }] } });
      }
      assert(!url.pathname.startsWith('/api/settings'), 'Never access real key settings');
      return route.continue();
    });
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: '문항과 성취기준을 확인하세요' })).toBeVisible();
    await expect(page.locator('#document-security-warning')).toBeVisible();
    await expect(page.locator('#document-security-warning')).toContainText('외부 반출 금지 문서를 넣지 마세요');
    await expect(page.locator('#document-security-warning')).toContainText('최초 PDF 분석은 로컬 처리');
    await expect(page.getByText('선택 문항 API 연결됨 · 대기', { exact: true })).toBeVisible();
    await expect(page.getByText('첫 분석은 로컬 · 자동 API 판독 꺼짐', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '이 문항만 API로 판독', exact: true })).toBeDisabled();
    const sidebar = page.getByRole('complementary', { name: '현재 PDF·API 설정', exact: true });
    await expect(sidebar).toHaveCSS('overflow-y', 'auto');
    await page.screenshot({ path: path.join(temporary, 'initial.png') });
    assert.deepEqual(result.errors, [], 'Initial page must have no runtime/console errors');
    assert.equal(result.acceptedRequests.length, 0);

    for (const input of inputs) {
      await page.getByLabel('PDF 파일 선택', { exact: true }).setInputFiles(input.path);
      await expect(page.getByRole('heading', { name: 'API 없이 문항을 분석하고 있습니다' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '문항과 성취기준을 확인하세요' })).toBeVisible({ timeout: 120000 });
      await expect(page.getByRole('article')).toHaveCount(input.count);
      await expect(page.getByRole('button', { name: '이 문항만 API로 판독', exact: true })).toBeEnabled();
      assert.equal(result.acceptedRequests.length, 0, 'Saved API connection must not trigger automatic recognition');
      result.initialUploads.push({ questions: input.count, recognitionRequests: 0 });
      console.log(JSON.stringify({ checkpoint: 'local-upload', questions: input.count, recognitionRequests: 0 }));
    }

    const first = page.getByRole('article', { name: '1번 추출 문항', exact: true });
    const unrelatedBefore = await page.getByRole('article').allTextContents();
    const manual = page.getByRole('button', { name: '이 문항만 API로 판독', exact: true });
    let dialogMessage = '';
    page.once('dialog', async dialog => { dialogMessage = dialog.message(); await dialog.dismiss(); });
    await manual.click();
    await expect(manual).toBeEnabled();
    assert.match(dialogMessage, /1번 문항/);
    assert.match(dialogMessage, /검증용 연결/);
    assert.match(dialogMessage, /API 요금/);
    assert.match(dialogMessage, /공통 지문/);
    assert.match(dialogMessage, /외부 반출 금지 자료라면 취소/);
    assert.equal(result.acceptedRequests.length, 0, 'Cancelling must send no recognition request');
    result.cancelledRequests = 0;

    page.once('dialog', dialog => dialog.accept());
    await manual.click();
    await expect.poll(() => result.acceptedRequests.length).toBe(1);
    assert.deepEqual(result.acceptedRequests[0], [1]);
    await expect(page.getByRole('button', { name: '이 문항 API 판독 중…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'PDF 바꾸기', exact: true })).toBeDisabled();
    pendingResponse();
    await expect(manual).toBeEnabled();
    const unrelatedAfter = await page.getByRole('article').allTextContents();
    assert.deepEqual(unrelatedAfter.slice(1), unrelatedBefore.slice(1), 'Only the selected question may change');
    assert.equal(result.acceptedRequests.length, 1);
    await expect(first).toBeVisible();

    // Reject a late response if the user edits while the explicit request is in flight.
    page.once('dialog', dialog => dialog.accept());
    await manual.click();
    await expect.poll(() => result.acceptedRequests.length).toBe(2);
    const editor = page.getByRole('textbox', { name: '문항 텍스트', exact: true });
    const edited = (await editor.innerText()) + '\n직접 편집 보호 검증';
    await editor.fill(edited);
    pendingResponse();
    await expect(manual).toBeEnabled();
    await expect(editor).toContainText('직접 편집 보호 검증');
    result.editDuringRequestPreserved = true;
    dialogMessage = '';
    page.once('dialog', async dialog => { dialogMessage = dialog.message(); await dialog.dismiss(); });
    await manual.click();
    await expect(manual).toBeEnabled();
    assert.match(dialogMessage, /직접 편집한 내용/);
    assert.equal(result.acceptedRequests.length, 2);

    const bulk = page.getByRole('button', { name: '전체 문항 API 판독', exact: true });
    const total = inputs.at(-1).count;
    dialogMessage = '';
    page.once('dialog', async dialog => { dialogMessage = dialog.message(); await dialog.dismiss(); });
    await bulk.click();
    await expect(bulk).toBeEnabled();
    assert.match(dialogMessage, new RegExp(`전체 ${total}문항`));
    assert.match(dialogMessage, /검증용 연결/);
    assert.match(dialogMessage, /API 판독 비용/);
    assert.match(dialogMessage, /외부 반출 금지 자료라면 취소/);
    assert.match(dialogMessage, /직접 편집한 문항/);
    assert.equal(result.acceptedRequests.length, 2);
    result.bulkCancelRequests = 0;

    // Full batch, exactly one sequential request per question; upload remains local.
    autoRespond = true;
    page.once('dialog', dialog => dialog.accept());
    await bulk.click();
    await expect(bulk).toBeEnabled({ timeout: 120000 });
    assert.deepEqual(result.acceptedRequests.slice(2), Array.from({ length: total }, (_, index) => [index + 1]));
    await expect(page.getByRole('status').filter({ hasText: '전체 API 판독 처리 완료' })).toContainText(`응답 완료 ${total}/${total}문항`);
    result.bulkCompleteRequests = total;

    // Stop while question 1 is in flight: keep that response, never send question 2.
    const beforeStop = result.acceptedRequests.length;
    autoRespond = false;
    page.once('dialog', dialog => dialog.accept());
    await bulk.click();
    await expect.poll(() => result.acceptedRequests.length).toBe(beforeStop + 1);
    await expect(page.getByRole('button', { name: 'PDF 바꾸기', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '이 문항 API 판독 중…', exact: true })).toBeDisabled();
    await editor.fill((await editor.innerText()) + '\n전체 판독 중 편집 보호 검증');
    await page.getByRole('button', { name: '현재 문항 후 중단', exact: true }).click();
    pendingResponse();
    await expect(bulk).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: '전체 판독 중단' })).toContainText(`미요청 ${total - 1}문항`);
    await expect(editor).toContainText('전체 판독 중 편집 보호 검증');
    assert.equal(result.acceptedRequests.length, beforeStop + 1);
    result.bulkStopRequests = 1;
    result.bulkEditDuringRequestPreserved = true;

    // A provider failure stops the job, without repeating the failing paid call.
    const beforeFailure = result.acceptedRequests.length;
    autoRespond = true; failureNumber = 2;
    page.once('dialog', dialog => dialog.accept());
    await bulk.click();
    await expect(bulk).toBeEnabled({ timeout: 120000 });
    assert.deepEqual(result.acceptedRequests.slice(beforeFailure), [[1], [2]]);
    await expect(page.getByRole('status').filter({ hasText: '오류로 전체 판독 중단' })).toContainText('실패 1문항');
    await expect(page.getByRole('alert')).toContainText('모의 공급자 실패');
    result.bulkFailureRequests = 2;
    failureNumber = null;

    const beforeUnavailable = result.acceptedRequests.length;
    available = false;
    await manual.click();
    await expect(page.getByRole('alert')).toContainText('먼저 API 연결을 설정해 주세요.');
    await expect(manual).toBeEnabled();
    assert.equal(result.acceptedRequests.length, beforeUnavailable, 'Unavailable API must not send recognition requests');
    await bulk.click();
    await expect(bulk).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('먼저 API 연결을 설정해 주세요.');
    assert.equal(result.acceptedRequests.length, beforeUnavailable, 'Unavailable API must block bulk too');
    result.missingKeyBlocked = true;
    await page.screenshot({ path: path.join(temporary, 'manual.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: '문항과 성취기준을 확인하세요' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temporary, 'mobile.png') });
    assert.deepEqual(result.errors, [], 'Browser runtime/console errors');
    assert.deepEqual(result.externalRequests, [], 'No external network requests are expected');
    result.status = 'PASS';
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.writeFileSync(path.join(temporary, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, artifacts: temporary }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
