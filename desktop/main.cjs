/* oxlint-disable typescript/no-require-imports */
const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODEL = 'gpt-4o-mini';
const APP_SCHEME = 'munhang';
const APP_HOST = 'app';
const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const RENDERER_DIR = path.join(__dirname, 'renderer-dist');
let apiKey = '';
let setupWindow;
let mainWindow;

function storedKeyPath() {
  return path.join(app.getPath('userData'), 'openai-api-key.bin');
}

function isValidApiKey(value) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(value);
}

function loadStoredApiKey() {
  if (!safeStorage.isEncryptionAvailable()) return '';
  try {
    const value = safeStorage.decryptString(fs.readFileSync(storedKeyPath()));
    return isValidApiKey(value) ? value : '';
  } catch {
    return '';
  }
}

function storeApiKey(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 컴퓨터에서 API 키 보안 저장소를 사용할 수 없습니다.');
  }
  fs.mkdirSync(path.dirname(storedKeyPath()), { recursive: true });
  fs.writeFileSync(storedKeyPath(), safeStorage.encryptString(value), { mode: 0o600 });
}

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
  },
}]);

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.host !== APP_HOST) return new Response('Not found', { status: 404 });

    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    const rendererRoot = path.resolve(RENDERER_DIR);
    const targetPath = path.resolve(rendererRoot, relativePath);
    if (!targetPath.startsWith(`${rendererRoot}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(targetPath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function windowOptions(overrides = {}) {
  return {
    show: false,
    backgroundColor: '#eef6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...overrides,
  };
}

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow(windowOptions({ width: 500, height: 610, resizable: false, title: '문항맵 설정' }));
  setupWindow.removeMenu();
  setupWindow.once('ready-to-show', () => setupWindow.show());
  void setupWindow.loadFile(path.join(__dirname, 'key-setup.html'));
  setupWindow.on('closed', () => { setupWindow = undefined; });
}

function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow(windowOptions({ width: 1440, height: 920, minWidth: 1040, minHeight: 700, title: '문항맵' }));
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol !== `${APP_SCHEME}:` || target.host !== APP_HOST) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  void mainWindow.loadURL(APP_URL);
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

function finishSetup() {
  createMainWindow();
  setupWindow?.close();
  setupWindow = undefined;
}

ipcMain.handle('setup:set-api-key', (_event, value) => {
  const next = typeof value === 'string' ? value.trim() : '';
  if (!isValidApiKey(next)) return { ok: false, error: 'API 키 형식을 확인해 주세요.' };
  try {
    storeApiKey(next);
    apiKey = next;
    finishSetup();
    return { ok: true };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : 'API 키를 안전하게 저장하지 못했습니다.' };
  }
});

ipcMain.handle('setup:skip-api-key', () => {
  finishSetup();
  return { ok: true };
});

ipcMain.handle('setup:open', () => {
  createSetupWindow();
  return { ok: true };
});

ipcMain.handle('vision:status', () => ({ available: Boolean(apiKey), model: MODEL, desktop: true }));

ipcMain.handle('vision:recognize', async (_event, body) => {
  if (!apiKey) return { error: '앱을 다시 열고 OpenAI API 키를 입력해 주세요.' };
  if (!body?.image?.startsWith('data:image/jpeg;base64,') || body.image.length > 7_000_000) return { error: '분석할 PDF 페이지 이미지가 올바르지 않습니다.' };
  const questions = Array.isArray(body.questions)
    ? body.questions.slice(0, 20).filter((question) => Number.isFinite(question.number) && typeof question.text === 'string' && question.text)
    : [];
  if (!questions.length) return { error: '분석할 문항이 없습니다.' };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest(body.image, questions)),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { error: payload?.error?.message || 'OpenAI 비전 분석 요청에 실패했습니다.' };
    const outputText = payload?.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
    if (!outputText) return { error: '비전 분석 결과가 비어 있습니다.' };
    return JSON.parse(outputText);
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : '비전 분석을 완료하지 못했습니다.' };
  }
});

function makeRequest(image, questions) {
  return {
    model: MODEL,
    store: false,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `이 이미지는 한국어 시험지의 한 페이지입니다. 아래 대상 문항을 이미지에서 다시 찾아 완전한 문항 구조와 그림 영역을 판독하세요.\n\n${questions.map((question) => `${question.number}번 기존 추출문:\n${question.text}`).join('\n\n')}\n\n문항 구조 규칙:\n1. 하나의 문항은 문항 번호부터 다음 문항 번호 직전까지입니다. 시험지가 2단이면 반드시 같은 단 안에서만 찾으세요.\n2. 그림·표·자료가 있는 문항은 보통 자료 위의 간접 발문, 자료, 자료 아래의 직접 발문, 배점, 선택지 순서입니다. 위와 아래 문장을 빠뜨리지 마세요.\n3. indirectStem에는 그림 위의 설명·간접 발문을, directStem에는 그림 아래의 질문·직접 발문과 배점을 넣으세요. 그림이 없으면 indirectStem은 빈 문자열이고 directStem에 전체 발문을 넣으세요.\n4. choices에는 ①~⑤ 등 모든 선택지를 원문 순서로 각각 넣으세요. 문장을 요약하거나 일부만 반환하지 마세요.\n5. latexText에는 indirectStem, directStem, choices를 원문 읽기 순서로 합친 완전한 문항을 넣으세요. 문항 번호 자체는 제외하세요.\n6. 원문에 실제로 보이는 수식·숫자·단위만 복원하고, 수식과 과학 단위는 KaTeX 호환 LaTeX로 바꾸세요. 일반 한글은 LaTeX의 \\text{}로 감싸지 마세요.\n7. questionBox는 해당 문항 전체(간접 발문부터 마지막 선택지까지)의 페이지 기준 0~1 좌표 [x,y,width,height]입니다.\n8. figureBox는 해당 문항의 그림·그래프·표·회로·지도와 그 내부 표기만 포함하는 페이지 기준 좌표입니다. 간접 발문, 직접 발문, 선택지, 다른 문항은 제외하고 questionBox 안에 있어야 합니다.\n9. 그림자료가 없으면 hasFigure=false, figureBox=null입니다. 전달받은 모든 문항 번호를 정확히 한 번씩 반환하세요.`,
        },
        { type: 'input_image', image_url: image, detail: 'high' },
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'exam_page_recognition',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'integer' },
                  latexText: { type: 'string' },
                  indirectStem: { type: 'string' },
                  directStem: { type: 'string' },
                  choices: { type: 'array', items: { type: 'string' } },
                  questionBox: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
                  hasFigure: { type: 'boolean' },
                  figureBox: { anyOf: [{ type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 }, { type: 'null' }] },
                },
                required: ['number', 'latexText', 'indirectStem', 'directStem', 'choices', 'questionBox', 'hasFigure', 'figureBox'],
                additionalProperties: false,
              },
            },
          },
          required: ['questions'],
          additionalProperties: false,
        },
      },
    },
  };
}

void app.whenReady().then(() => {
  registerAppProtocol();
  apiKey = loadStoredApiKey();
  if (apiKey) createMainWindow();
  else createSetupWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      if (apiKey) createMainWindow();
      else createSetupWindow();
    }
  });
});

app.on('window-all-closed', () => {
  apiKey = '';
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { apiKey = ''; });
