/* oxlint-disable typescript/no-require-imports */
// Optional browser regression test. Every settings/status response is mocked;
// no real keys, document uploads, provider requests, or user data are accessed.
// MUNHANG_PLAYWRIGHT_MODULE=/absolute/playwright/test.js \
// MUNHANG_TEST_SERVER=/absolute/unpacked/server.cjs node tests/api-settings-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium, expect } = require(process.env.MUNHANG_PLAYWRIGHT_MODULE || 'playwright/test');
const { PROVIDERS } = require('../desktop/provider-client.cjs');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-api-settings-'));
  const result = {
    status: 'RUNNING', guides: [], settingsReads: 0, settingsSaves: 0,
    recognitionRequests: 0, externalRequests: [], unexpectedWrites: [], errors: [],
  };
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
    const status = {
      available: true, local: true, desktop: false, provider: 'openai',
      providerLabel: 'OpenAI', model: 'mock-vision', keyHint: 'test-****',
      storageLabel: '검증용 격리 저장소', settingsUrl: '/settings.html',
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      estimatedRemainingUsd: 10,
    };
    const connection = {
      provider: 'openai', model: 'mock-vision', baseUrl: '',
      budgetUsd: 10, inputPrice: 0, outputPrice: 0,
    };
    const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([id, info]) => [id, {
      label: info.label, defaultModel: info.defaultModel,
      defaultInputPrice: info.defaultInputPrice, defaultOutputPrice: info.defaultOutputPrice,
    }]));
    let lastSave;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        result.externalRequests.push(url.origin);
        return route.abort();
      }
      if (url.pathname === '/api/settings') {
        if (request.method() === 'GET') {
          result.settingsReads += 1;
          return route.fulfill({ json: { providers, connection, status } });
        }
        if (request.method() === 'POST') {
          result.settingsSaves += 1;
          lastSave = request.postDataJSON();
          // Never forward this request to the server/keychain or print its body.
          return route.fulfill({ json: { ok: true, status: {
            ...status, provider: lastSave.provider,
            providerLabel: providers[lastSave.provider].label, model: lastSave.model,
          } } });
        }
        return route.abort();
      }
      if (url.pathname === '/api/recognize') {
        if (request.method() === 'GET') return route.fulfill({ json: status });
        result.recognitionRequests += 1;
        return route.abort();
      }
      if (url.pathname === '/api/question-bank' && request.method() === 'GET') {
        return route.fulfill({ json: { items: [], storageLabel: '검증용 빈 문제함' } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        result.unexpectedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(origin);
    await expect(page.getByRole('heading', { name: '문항과 성취기준을 확인하세요' })).toBeVisible();
    const warning = page.locator('#document-security-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('외부 반출 금지 문서를 넣지 마세요');
    await expect(warning).toContainText('최초 PDF 분석은 로컬 처리');
    await expect(warning).toContainText('공통 지문 포함');
    await expect(warning).toContainText('자동 판별하지 않습니다');
    assert((await warning.boundingBox()).y < 982, 'Home warning is visible before any document interaction');
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(temporary, 'home-desktop.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(temporary, 'home-mobile.png') });
    result.homeWarning = true;

    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(`${origin}/settings.html`);
    await expect(page.getByRole('heading', { name: 'AI 공급자 연결', exact: true })).toBeVisible();
    await expect(page.locator('#connectionText')).toHaveText('OpenAI 연결됨');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('role', 'note');
    await expect(warning).toContainText('외부 반출 금지 문서를 넣지 마세요');
    const warningBox = await warning.boundingBox(), mainBox = await page.locator('main').boundingBox();
    assert(warningBox.y < 982, 'Settings warning is near the top');
    assert(Math.abs(warningBox.width - mainBox.width) <= 2, 'Settings warning spans both columns');
    const provider = page.locator('#provider'), model = page.locator('#model'), key = page.locator('#apiKey');
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await expect(key).toHaveAttribute('placeholder', '변경할 때만 입력');
    await expect(page.locator('#keyHint')).toHaveText('test-****');
    await expect(page.locator('#key-guide-openai')).toHaveAttribute('open', '');

    // Reading the help is side-effect free, even with an unsaved input.
    const syntheticKey = 'not-a-real-api-key-for-ui-test';
    await model.fill('unsaved-model-for-ui-test');
    await key.fill(syntheticKey);
    await page.locator('#budgetUsd').fill('12.34');
    const allowedHosts = new Set([
      'platform.openai.com', 'developers.openai.com', 'platform.claude.com',
      'console.anthropic.com', 'ai.google.dev', 'aistudio.google.com',
    ]);
    for (const id of ['openai', 'anthropic', 'gemini']) {
      const guide = page.locator(`#key-guide-${id}`);
      if (!(await guide.evaluate(element => element.open))) await guide.locator('summary').click();
      await expect(guide).toHaveAttribute('open', '');
      const steps = guide.locator('ol > li');
      assert(await steps.count() >= 3, `${id} has actionable key issuance steps`);
      await expect(steps.first()).toBeVisible();
      const links = await guide.locator('a').evaluateAll(elements => elements.map(element => ({
        href: element.href, target: element.target, rel: element.rel,
      })));
      assert(links.length >= 2, `${id} includes a key console and official instructions`);
      for (const link of links) {
        const url = new URL(link.href);
        assert.equal(url.protocol, 'https:');
        assert(allowedHosts.has(url.hostname), `${id} help links only to an official provider domain`);
        assert.equal(link.target, '_blank');
        assert(link.rel.split(/\s+/).includes('noopener'));
        assert(link.rel.split(/\s+/).includes('noreferrer'));
      }
      result.guides.push({ provider: id, steps: await steps.count(), officialLinks: links.length });
      await expect(model).toHaveValue('unsaved-model-for-ui-test');
      await expect(key).toHaveValue(syntheticKey);
      await expect(page.locator('#budgetUsd')).toHaveValue('12.34');
    }
    assert.equal(result.settingsSaves, 0, 'Reading guides must not save connection inputs');
    assert.equal(result.recognitionRequests, 0, 'Reading guides must not call recognition');

    // Provider switching shows the matching help and retains existing key semantics.
    for (const id of ['anthropic', 'gemini', 'openai']) {
      await provider.selectOption(id);
      await expect(page.locator(`#key-guide-${id}`)).toHaveAttribute('open', '');
      await expect(model).toHaveValue(providers[id].defaultModel);
      await expect(key).toHaveValue('');
      await expect(key).toHaveAttribute('placeholder', id === 'openai' ? '변경할 때만 입력' : '새 공급자의 API 키');
    }
    result.matchingGuideOnProviderChange = true;
    await page.locator('#save').click();
    await expect(page.locator('#message')).toHaveText('연결 설정을 안전하게 저장했습니다.');
    assert.equal(result.settingsSaves, 1);
    assert(lastSave.apiKey === '', 'Empty input preserves an existing saved-key request');
    assert.equal(lastSave.provider, 'openai');
    result.blankKeySavePreserved = true;
    await key.fill(syntheticKey);
    await page.locator('#save').click();
    await expect.poll(() => result.settingsSaves).toBe(2);
    await expect(key).toHaveValue('');
    assert(lastSave.apiKey === syntheticKey, 'Explicit key input is sent only to the mocked local save endpoint');
    await expect(key).toHaveAttribute('placeholder', '변경할 때만 입력');
    assert(!(await page.content()).includes(syntheticKey), 'Saved key must not be exposed in rendered HTML');
    assert(!(await page.locator('body').innerText()).includes(syntheticKey), 'Saved key must not appear in text/status');
    result.savedInputCleared = true;

    // All guides can be expanded for review, without viewport overflow on mobile.
    for (const id of ['openai', 'anthropic', 'gemini']) {
      const guide = page.locator(`#key-guide-${id}`);
      if (!(await guide.evaluate(element => element.open))) await guide.locator('summary').click();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(temporary, 'settings-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalOverflow(page);
    await expect(warning).toBeVisible();
    for (const id of ['openai', 'anthropic', 'gemini']) await expect(page.locator(`#key-guide-${id}`)).toHaveAttribute('open', '');
    await page.screenshot({ path: path.join(temporary, 'settings-mobile.png'), fullPage: true });
    result.mobileWidth = 375;
    assert.equal(result.recognitionRequests, 0);
    assert.deepEqual(result.externalRequests, [], 'No provider page is loaded until the user follows a link');
    assert.deepEqual(result.unexpectedWrites, [], 'No unmocked writes are permitted');
    assert.deepEqual(result.errors, [], 'Browser runtime and console remain error-free');
    result.status = 'PASS';
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.writeFileSync(path.join(temporary, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, artifacts: temporary }, null, 2));
  }
}

async function assertNoHorizontalOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page-wide horizontal overflow');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
