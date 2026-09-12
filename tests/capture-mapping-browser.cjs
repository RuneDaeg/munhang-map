/* oxlint-disable typescript/no-require-imports */
// Optional release-browser regression. Synthetic images/review/bank records only;
// no provider request, private PDF, saved API key, or real question bank is used.
// MUNHANG_PLAYWRIGHT_MODULE=/absolute/playwright/test.js \
// MUNHANG_TEST_SERVER=/absolute/unpacked/server.cjs node tests/capture-mapping-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium, expect } = require(process.env.MUNHANG_PLAYWRIGHT_MODULE || 'playwright/test');

const CSV_HEADERS = ['이미지 파일', '성취기준 코드', '성취기준 내용', '교과', '원본 PDF', '원본 문항 번호', '캡처 순번', '원본 쪽'];
const GROUPED_BUTTON = '성취기준별 캡처 · ZIP';
const FLAT_BUTTON = '캡처 이미지만 · ZIP';

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'munhang-capture-mapping-'));
  const result = {
    status: 'RUNNING', downloads: [], bankSelections: [], recognitionRequests: 0,
    settingsRequests: 0, externalRequests: [], unexpectedWrites: [], errors: [],
  };
  const child = spawn(process.execPath, [process.env.MUNHANG_TEST_SERVER || path.join(__dirname, '../local/server.cjs')], {
    env: { ...process.env, MUNHANG_DATA_DIR: path.join(temporary, 'data'), MUNHANG_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser, page;
  try {
    const origin = await waitForServer(child);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, serviceWorkers: 'block' });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    let bank = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        result.externalRequests.push(url.origin);
        return route.abort();
      }
      if (url.pathname === '/api/recognize') {
        if (request.method() === 'GET') return route.fulfill({ json: {
          available: false, local: true, settingsUrl: '/settings.html',
          usage: { requests: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
        } });
        result.recognitionRequests += 1;
        return route.abort();
      }
      if (url.pathname.startsWith('/api/settings')) {
        result.settingsRequests += 1;
        return route.abort();
      }
      if (url.pathname === '/api/question-bank' && request.method() === 'GET') {
        return route.fulfill({ json: { items: bank.map(({ id, question }) => ({
          id, sourceFileName: question.sourceFileName, savedAt: '2000-01-01T00:00:00Z',
          number: question.number, standardCode: question.standardCode,
          domain: question.domain, text: question.text, confidence: 0,
        })) } });
      }
      if (url.pathname === '/api/question-bank/selection' && request.method() === 'POST') {
        const { ids } = request.postDataJSON();
        assert(Array.isArray(ids) && ids.every(id => bank.some(item => item.id === id)));
        result.bankSelections.push(ids);
        return route.fulfill({ json: { questions: ids.map(id => bank.find(item => item.id === id).question) } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        result.unexpectedWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(origin);
    await expect(page.getByRole('heading', { name: '문항과 성취기준을 확인하세요' })).toBeVisible();
    await expect(page.locator('#document-security-warning')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    assert.deepEqual(result.errors, [], 'Initial browser page must be usable');
    const images = await page.evaluate(() => ['#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe', '#fee2e2'].map((color, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 300;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = color; drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = '#111827'; drawing.font = '28px sans-serif';
      drawing.fillText(`SYNTHETIC TEST CAPTURE ${index + 1}`, 30, 70);
      drawing.strokeRect(30, 110, 520, 130);
      return canvas.toDataURL(index % 2 ? 'image/png' : 'image/jpeg', 0.94);
    }));

    // Actual review import + explicit candidate change: the download must use the
    // mapping currently selected on screen, not its initial recommendation.
    const review = {
      format: 'munhang-map-review', version: 1, fileName: '합성 검토.pdf', sourcePages: [images[0]],
      questions: [{ number: 1, type: '합성 검증 문항 · 1쪽',
        text: '1. 지수가 유리수인 거듭제곱의 값을 지수법칙으로 계산한 것은? [2점]\n① 1\n② 2\n③ 4\n④ 8\n⑤ 16',
        standardCode: '', standard: '', domain: '', confidence: 0, sourcePage: 1,
        selectedSubjectKey: '고등학교|대수',
        examSubject: { label: '수학', headerText: '합성 검증용 수학', page: 1, subjectKeys: ['고등학교|대수'] },
        regions: [{ page: 1, box: [0, 0, 1, 1] }], captureReviewed: true,
      }],
    };
    await page.getByLabel('검토 파일 선택', { exact: true }).setInputFiles({
      name: 'synthetic-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(review)),
    });
    await expect(page.getByRole('article', { name: '1번 추출 문항', exact: true })).toBeVisible();
    const standardSelect = page.locator('#question-standard');
    const current = await standardSelect.inputValue();
    const options = await standardSelect.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
    const changed = options.find(code => code && code !== current);
    assert(changed, 'Synthetic question provides another candidate for a real manual mapping change');
    await standardSelect.selectOption(changed);
    await expect(standardSelect).toHaveValue(changed);
    const reviewImage = await page.getByRole('img', { name: '1번 문항의 발문, 그림자료, 선택지를 포함한 원문 캡처 1', exact: true }).getAttribute('src');
    const catalog = parseCsv(fs.readFileSync(path.join(__dirname, '../public/data/achievement-standards.csv'), 'utf8'));
    const chosenRecord = catalog.find(row => row[3] === changed);
    assert(chosenRecord, 'The chosen code exists in the bundled catalog');
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '문항 내보내기', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#capture-export-grouping')).toHaveValue('standard');
    await expect(dialog.getByRole('button', { name: GROUPED_BUTTON, exact: true })).toBeEnabled();
    const reviewArchive = await downloadArchive(page, dialog, GROUPED_BUTTON, temporary, 'review-grouped.zip');
    assert.equal(reviewArchive.fileName, '합성 검토_성취기준별_문항캡처.zip');
    const reviewRows = mappingRows(reviewArchive.files);
    assert.equal(reviewRows.length, 1);
    assert.equal(reviewRows[0][1], changed);
    assert.notEqual(reviewRows[0][1], current);
    assert.equal(reviewRows[0][2], chosenRecord[4]);
    assert.equal(reviewRows[0][4], '합성 검토.pdf');
    assert.equal(reviewRows[0][5], '1');
    assert.deepEqual(reviewArchive.files.get(reviewRows[0][0]), imageBytes(reviewImage));
    result.reviewMappingChange = { previous: current, exported: changed, imageBytesPreserved: true };
    result.downloads.push({ flow: 'review', name: reviewArchive.fileName, images: reviewRows.length });

    // Saved bank mappings are intentionally different from decoy candidates. Same
    // numbers across source PDFs and a multi-page question exercise identity/order.
    const common = {
      type: '합성 검증 문항', text: '합성 문제함 검증 — 실제 시험 문항이 아닙니다.', confidence: 0,
      standardCandidates: [{ code: '[DECOY-DO-NOT-EXPORT]', domain: '잘못된 후보', standard: '후보는 저장된 선택이 아닙니다.', confidence: 100 }],
      captureReviewed: true,
    };
    const capture = (index, pageNumber) => ({ page: pageNumber, box: [0, 0, 1, 1], image: images[index] });
    bank = [
      { id: 'physics-a', question: { ...common, number: 6, sourceFileName: '/synthetic/private/물리 A.pdf',
        standardCode: '[12물리01-01]', domain: '고등학교 · 물리학', standard: '검증용 "선택한" 성취기준, 첫째 줄\n둘째 줄까지 그대로 보존합니다.',
        questionCaptures: [capture(0, 1)] } },
      { id: 'physics-b', question: { ...common, number: 6, sourceFileName: 'C:\\synthetic\\private\\물리 B.pdf',
        standardCode: '[12물리01-01]', domain: '고등학교 · 물리학', standard: '같은 코드라도 저장된 전문을 사용합니다.',
        questionCaptures: [capture(1, 2), capture(2, 3)] } },
      { id: 'chemistry', question: { ...common, number: 20, sourceFileName: '화학.pdf',
        standardCode: '[12화학01-01]', domain: '고등학교 · 화학', standard: '다른 교과의 성취기준 전체 문장입니다.',
        questionCaptures: [capture(3, 4)] } },
      { id: 'unclassified', question: { ...common, number: 7, sourceFileName: '미분류.pdf',
        standardCode: '', domain: '', standard: '', questionCaptures: [capture(4, 1)] } },
      { id: 'missing', question: { ...common, number: 8, sourceFileName: '캡처 누락.pdf',
        standardCode: '[12물리01-01]', domain: '고등학교 · 물리학', standard: '캡처 없음 검증', questionCaptures: [] } },
    ];
    await page.getByRole('button', { name: '내 문제함', exact: true }).click();
    const bankDialog = page.getByRole('dialog', { name: '내 문제함', exact: true });
    await expect(bankDialog).toContainText('이 컴퓨터에 저장한 5문항');
    for (const { question } of bank.slice(0, 4)) await bankDialog.getByRole('checkbox', { name: `${question.sourceFileName} ${question.number}번 선택`, exact: true }).check();
    await bankDialog.getByRole('button', { name: '선택 4문항 내보내기', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '문항 내보내기', exact: true });
    await expect(dialog).toContainText('캡처 이미지만 받기 · 5장');
    await expect(dialog.locator('#capture-export-grouping')).toHaveValue('standard');
    await expect(dialog.locator('#export-grouping')).toHaveValue('standard');
    await dialog.locator('#export-grouping').selectOption('single');
    await expect(dialog.locator('#capture-export-grouping')).toHaveValue('standard');
    await dialog.locator('#capture-export-grouping').selectOption('single');
    await expect(dialog.locator('#export-grouping')).toHaveValue('single');
    await dialog.locator('#export-grouping').selectOption('standard');
    await expect(dialog.locator('#capture-export-grouping')).toHaveValue('single');
    await dialog.locator('#capture-export-grouping').selectOption('standard');
    result.independentGroupingSelectors = true;
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(temporary, 'capture-export-desktop.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoHorizontalOverflow(page);
    await expect(dialog.locator('#capture-export-grouping')).toBeVisible();
    await expect(dialog.getByRole('button', { name: GROUPED_BUTTON, exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: GROUPED_BUTTON, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temporary, 'capture-export-mobile.png'), animations: 'disabled' });
    result.mobileWidth = 375;
    const grouped = await downloadArchive(page, dialog, GROUPED_BUTTON, temporary, 'bank-grouped.zip');
    assert.equal(grouped.fileName, '내 문제함_성취기준별_문항캡처.zip');
    assertGroupedBankArchive(grouped.files, bank.slice(0, 4));
    result.downloads.push({ flow: 'bank-grouped-mobile', name: grouped.fileName, images: 5, groups: 3 });
    result.savedBankMappingPreserved = true;

    await page.setViewportSize({ width: 1512, height: 982 });
    await bankDialog.getByRole('button', { name: '선택 4문항 내보내기', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '문항 내보내기', exact: true });
    await dialog.locator('#capture-export-grouping').selectOption('single');
    await expect(dialog.locator('#export-grouping')).toHaveValue('standard');
    const flat = await downloadArchive(page, dialog, FLAT_BUTTON, temporary, 'bank-flat.zip');
    assert.equal(flat.fileName, '내 문제함_문항캡처.zip');
    assert.equal(flat.files.size, 5);
    assert([...flat.files.keys()].every(name => !name.includes('/') && /\.(jpg|png)$/.test(name)));
    for (const [name, data] of grouped.files) {
      if (name === '문항목록.csv') continue;
      assert.deepEqual(flat.files.get(name.split('/').at(-1)), data, 'Flat export keeps original filenames and exact image bytes');
    }
    result.downloads.push({ flow: 'bank-flat', name: flat.fileName, images: 5, csv: false });

    // A selected item without captures blocks both variants; no silent omission.
    await bankDialog.getByRole('button', { name: '선택 해제', exact: true }).click();
    const missing = bank.at(-1).question;
    await bankDialog.getByRole('checkbox', { name: `${missing.sourceFileName} ${missing.number}번 선택`, exact: true }).check();
    await bankDialog.getByRole('button', { name: '선택 1문항 내보내기', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '문항 내보내기', exact: true });
    await expect(dialog).toContainText('캡처가 없는 문항 1개');
    await expect(dialog.getByRole('button', { name: GROUPED_BUTTON, exact: true })).toBeDisabled();
    await dialog.locator('#capture-export-grouping').selectOption('single');
    await expect(dialog.getByRole('button', { name: FLAT_BUTTON, exact: true })).toBeDisabled();
    result.missingCaptureBlocksBoth = true;
    assert.equal(result.recognitionRequests, 0, 'No export variant calls an AI provider');
    assert.equal(result.settingsRequests, 0, 'No export variant reads API-key settings');
    assert.deepEqual(result.externalRequests, []);
    assert.deepEqual(result.unexpectedWrites, []);
    assert.deepEqual(result.errors, []);
    result.status = 'PASS';
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => undefined);
      fs.writeFileSync(path.join(temporary, 'failure-text.txt'), await page.locator('body').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.writeFileSync(path.join(temporary, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, artifacts: temporary }, null, 2));
  }
}

function assertGroupedBankArchive(files, bank) {
  const rows = mappingRows(files);
  assert.equal(rows.length, 5);
  assert.equal(files.size, rows.length + 1, 'Only images and the mapping CSV are exported');
  assert.equal(new Set(rows.map(row => row[0].split('/')[0])).size, 3);
  let rowIndex = 0;
  for (const [index, { question }] of bank.entries()) {
    const source = question.sourceFileName.split(/[\\/]/).at(-1);
    for (const [part, capture] of question.questionCaptures.entries()) {
      const row = rows[rowIndex++];
      assert.match(row[0], /^\d{3}_[^/]+\/\d{3}_[^/]+\.(jpg|png)$/);
      assert(row[0].split('/').at(-1).startsWith(`${String(index + 1).padStart(3, '0')}_`), 'Selection order/identity is retained across PDF files');
      assert.equal(row[1], question.standardCode || '미분류');
      assert.equal(row[2], question.standard);
      assert.equal(row[3], question.standardCode ? question.domain : '분류 확인 필요');
      assert.equal(row[4], source, 'Only the source basename may appear in the mapping CSV');
      assert.equal(row[5], String(question.number));
      assert.equal(row[6], String(part + 1));
      assert.equal(row[7], String(capture.page));
      assert.deepEqual(files.get(row[0]), imageBytes(capture.image), 'Captures must not be re-encoded or annotated');
      if (!question.standardCode) assert(row[0].includes('미분류_분류 확인 필요'));
    }
  }
  assert(!files.get('문항목록.csv').toString('utf8').includes('DECOY'), 'Unselected candidate codes must not be exported');
  assert(!files.get('문항목록.csv').toString('utf8').includes('private'), 'No private path should be included');
}

async function downloadArchive(page, dialog, button, temporary, artifact) {
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: button, exact: true }).click();
  const download = await pending;
  await download.saveAs(path.join(temporary, artifact));
  assert.equal(await download.failure(), null);
  await expect(dialog).not.toBeVisible();
  return { fileName: download.suggestedFilename(), files: unzip(fs.readFileSync(path.join(temporary, artifact))) };
}

function mappingRows(files) {
  const csv = files.get('문항목록.csv');
  assert(csv, 'Grouped ZIP includes a root mapping CSV');
  assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV opens as UTF-8 in spreadsheet applications');
  const [headers, ...rows] = parseCsv(csv.toString('utf8'));
  assert.deepEqual(headers, CSV_HEADERS);
  return rows;
}

function parseCsv(value) {
  const text = value.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\r' || character === '\n') && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = '';
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else cell += character;
  }
  assert.equal(quoted, false, 'CSV quoting is balanced');
  if (row.length || cell) { row.push(cell); rows.push(row); }
  return rows;
}

function unzip(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6), method = bytes.readUInt16LE(offset + 8);
    const compressed = bytes.readUInt32LE(offset + 18), size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    assert(flags & 0x800, 'ZIP entry names must carry the UTF-8 flag');
    assert.equal(flags & 8, 0, 'ZIP uses known local sizes');
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const compressedData = bytes.subarray(start, start + compressed);
    const data = method === 0 ? compressedData : method === 8 ? inflateRawSync(compressedData) : null;
    assert(data, 'ZIP compression method is supported');
    assert.equal(data.length, size);
    assert.equal(crc32(data), bytes.readUInt32LE(offset + 14), 'Image/CSV ZIP entry CRC must match');
    assert(!files.has(name), 'No filename collisions');
    assert(!name.startsWith('/') && !name.split('/').includes('..'), 'No unsafe relative paths');
    files.set(name, data);
    offset = start + compressed;
  }
  assert(files.size > 0 && bytes.readUInt32LE(offset) === 0x02014b50, 'ZIP contains entries and a central directory');
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size);
  return files;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function imageBytes(dataUrl) { return Buffer.from(dataUrl.split(',')[1], 'base64'); }

async function assertNoHorizontalOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page-wide horizontal overflow');
  const dialog = page.getByRole('dialog', { name: '문항 내보내기', exact: true });
  if (await dialog.count()) assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Capture export dialog has no horizontal overflow');
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
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
}

main().catch(error => { console.error(error); process.exitCode = 1; });
