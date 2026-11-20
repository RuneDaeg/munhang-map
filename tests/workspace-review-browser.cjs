/* oxlint-disable typescript/no-require-imports */
// Run against a packaged local server. Pass the original three-question demo HWPX.
// The only API responses used by this test are local test doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium, expect } = require(process.env.MUNHANG_PLAYWRIGHT_MODULE || 'playwright/test');

async function main() {
  const fixture = process.argv[2];
  assert(fixture, 'Pass the three-question demo HWPX path');
  await fs.access(fixture);
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'munhang-workspace-qa-'));
  const server = spawn(process.execPath, [process.env.MUNHANG_TEST_SERVER || path.join(__dirname, '../local/server.cjs')], {
    env: { ...process.env, MUNHANG_NO_OPEN: '1', MUNHANG_DATA_DIR: data }, stdio: ['ignore','pipe','inherit'],
  });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      let log = '';
      server.stdout.on('data', chunk => {
        log += chunk;
        const address = log.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (address) resolve(address[0]);
      });
      server.once('exit', code => reject(new Error('Test server exited: ' + code)));
      server.once('error', reject);
    });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 }, serviceWorkers: 'block' });
    const status = { available: false, local:true, model:'mock', providerLabel:'테스트', usage:{requests:0,inputTokens:0,outputTokens:0,estimatedUsd:0} };
    let respond, sent = 0;
    const unexpected = [];
    await context.route('**/*', async route => {
      const { origin: host, pathname } = new URL(route.request().url());
      if (host !== origin) { unexpected.push(host); return route.abort(); }
      if (pathname === '/api/settings') return route.fulfill({ json: { status, providers: {openai:{label:'테스트',defaultModel:'mock',defaultInputPrice:0,defaultOutputPrice:0}}, connection:{provider:'openai',model:'mock'} } });
      if (pathname === '/api/recognize') {
        if (route.request().method() === 'GET') return route.fulfill({json:status});
        const q = route.request().postDataJSON().questions[0];
        sent++;
        await new Promise(resolve => { respond = resolve; });
        return route.fulfill({json:{questions:[{number:q.number,latexText:q.text + ' 모의응답 ' + sent,choices:[],hasFigure:false}]}});
      }
      if (pathname.startsWith('/api/')) { unexpected.push(pathname); return route.abort(); }
      return route.continue();
    });
    const p = await context.newPage();
    p.setDefaultTimeout(8000);
    const errors = [];
    p.on('pageerror', error => errors.push(error.message));
    p.on('dialog', dialog => dialog.accept());
    const button = name => p.getByRole('button',{name,exact:true});
    const activeStep = p.locator('[aria-current="step"]:visible');
    const rows = p.locator('article[aria-label$="추출 문항"]');
    const editor = p.getByRole('textbox',{name:'문항 텍스트',exact:true});
    const inspector = p.locator('.question-inspector:visible');
    const upload = p.locator('input[type=file][accept*=".hwpx"]').first();
    const reviewInput = p.getByLabel('검토 파일 선택',{exact:true});
    async function download(buttonName) {
      const [file] = await Promise.all([p.waitForEvent('download'), button(buttonName).click()]);
      return fs.readFile(await file.path());
    }
    await p.goto(origin);
    await expect(activeStep).toContainText('파일 불러오기');
    await expect(button('내 시험지 불러오기')).toBeEnabled();
    await button('도움말').click();
    await expect(p.getByRole('dialog')).toContainText('문항맵 사용법');
    await p.keyboard.press('Escape');
    await upload.setInputFiles(fixture);
    await expect(p.getByText('시험지 분석 완료',{exact:true})).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(activeStep).toContainText('문항 검토');
    const original = JSON.parse(await download('검토 JSON 저장'));
    assert.match(original.questions[0].text,/demoMotion/);
    assert.match(original.questions[1].text,/:::table/);
    assert.match(original.questions[2].text,/:::box/);
    for (const width of [1440,1200,390]) {
      await p.setViewportSize({width,height:800});
      const trigger = button('2번 문항 정보 보기');
      await trigger.click();
      await expect(inspector).toHaveAttribute('aria-label','2번 문항 정보');
      await expect.poll(async () => {
        const rect = await inspector.boundingBox();
        return rect && rect.y >= 0 && rect.y < 800;
      }).toBe(true);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth),width);
      if (width < 1280) {
        await button('문항 정보 닫기').click();
        await expect(trigger).toBeFocused();
      }
      console.log('PASS inspect/return', width);
    }
    await p.setViewportSize({width:1440,height:800});
    await button('2번 문항 정보 보기').click();
    const edited = original.questions[1].text + '\n교사 검토 완료';
    await editor.fill(edited);
    await p.locator('#question-answer').fill('④');
    const popupEvent = context.waitForEvent('page');
    await button('API 연결 설정').click();
    const popup = await popupEvent;
    await popup.waitForURL('**/settings.html*');
    status.available = true;
    await Promise.all([popup.waitForEvent('close'),popup.getByRole('link',{name:/문항맵으로 돌아가기/}).click()]);
    await p.bringToFront();
    await expect(inspector).toHaveAttribute('aria-label','2번 문항 정보');
    await expect(editor).toContainText('교사 검토 완료');
    await expect(p.locator('#question-answer')).toHaveValue('④');
    await upload.setInputFiles({name:'손상.hwpx',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});
    await expect(p.getByText(/손상\.hwpx 열기 실패/)).toBeVisible();
    await expect(button('검토 JSON 저장')).toBeEnabled();
    const kept = JSON.parse(await download('검토 JSON 저장'));
    assert.equal(kept.fileName,original.fileName);
    assert.equal(kept.questions.length,3);
    assert.equal(kept.questions[1].answer,'④');
    assert.match(kept.questions[1].text,/교사 검토 완료/);
    console.log('PASS settings and invalid upload kept edits, answers and file');
    for (const label of ['Word · DOCX','한글 · HWPX']) {
      await button('내보내기').click();
      await expect(p.getByRole('dialog')).toContainText('문항 내보내기');
      await p.locator('#export-grouping').selectOption('single');
      assert.equal((await download(label)).subarray(0,2).toString(),'PK');
    }
    // Inject warnings into a copy of the demo only, so the filter has two real matches.
    const warned = structuredClone(kept);
    for (const i of [0,2]) warned.questions[i].analysisWarning = '검토용 경고';
    await reviewInput.setInputFiles({name:'flags.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(warned))});
    const filter = p.getByRole('button',{name:/확인 필요만 보기/});
    await expect(filter).toBeEnabled();
    await filter.click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute('aria-label','3번 추출 문항');
    await button('다음 확인 문항').click();
    await expect(inspector).toHaveAttribute('aria-label','3번 문항 정보');
    await filter.click();
    await expect(rows).toHaveCount(3);
    assert.equal(sent,0);
    console.log('PASS warnings, question order, DOCX and HWPX');

    // HWPX has no page crops. A tiny PDF review fixture exercises PDF-only operations.
    const jpeg = await p.evaluate(() => {
      const c = document.createElement('canvas'); c.width=64; c.height=64;
      return c.toDataURL('image/jpeg');
    });
    const pdf = {format:'munhang-map-review',version:1,fileName:'합성.pdf',sourcePages:[jpeg],
      questions:[1,2].map(number=>({number,sourcePage:1,regions:[{page:1,box:[0,0,1,1]}],
        type:'자동 추출 문항 · 1쪽', text:number+'. 앞 문장의 개념을 확인합니다. 다음 문장의 원리를 확인합니다. 이 자료에 대한 설명은?',
        standardCode:'',standard:'',domain:'고등학교 · 통합과학1',confidence:0}))};
    await reviewInput.setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pdf))});
    await expect(rows).toHaveCount(2);
    await button('1번 문항 정보 보기').click();
    const api = button('이 문항만 API로 판독');
    await api.click();
    await expect.poll(()=>sent).toBe(1);
    await p.locator('#question-answer').fill('③');
    respond();
    await expect(editor).toContainText('모의응답 1');
    await expect(p.locator('#question-answer')).toHaveValue('③');
    await api.click();
    await expect.poll(()=>sent).toBe(2);
    await editor.fill(pdf.questions[0].text + ' 직접 수정본');
    respond();
    await expect(editor).toContainText('직접 수정본');
    await p.locator('summary').filter({hasText:'수정한 본문과 API 판독본 비교'}).click();
    await button('직접 수정본 유지').click();
    await expect(editor).toContainText('직접 수정본');
    await button('전체 문항 API 판독').click();
    await expect.poll(()=>sent).toBe(3);
    await editor.fill(pdf.questions[0].text + ' 전체 판독 중 직접 편집');
    await p.locator('#question-answer').fill('④');
    respond();
    await expect.poll(()=>sent).toBe(4);
    respond();
    await p.locator('summary').filter({hasText:'수정한 본문과 API 판독본 비교'}).click();
    await expect(editor).toContainText('전체 판독 중 직접 편집');
    await button('API 판독본 적용').click();
    await expect(editor).toContainText('모의응답 3');
    await expect(p.locator('#question-answer')).toHaveValue('④');
    await editor.focus(); await p.keyboard.press('Home');
    for(let i=0; i<18; i++) await p.keyboard.press('ArrowRight');
    await button('커서에서 문항 나누기').click();
    await expect(rows).toHaveCount(3);
    const split = await download('검토 JSON 저장');
    const splitQuestions = JSON.parse(split).questions;
    assert.equal(new Set(splitQuestions.map(q=>q.number)).size,3);
    await reviewInput.setInputFiles({name:'split.json',mimeType:'application/json',buffer:split});
    await expect(inspector).toHaveAttribute('aria-label','1번 문항 정보');
    const reopened = JSON.parse(await download('검토 JSON 저장'));
    assert.deepEqual(reopened.questions.map(q=>[q.number,q.text,q.answer]), splitQuestions.map(q=>[q.number,q.text,q.answer]));
    assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
    console.log('PASS delayed API, split and JSON round trip');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
