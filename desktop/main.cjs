/* oxlint-disable typescript/no-require-imports */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

const MODEL = 'gpt-4o-mini';
const SITE_URL = process.env.MUNHANG_MAP_URL || 'https://munhang-map.kmo4102.chatgpt.site/';
const SITE_ORIGIN = new URL(SITE_URL).origin;
let apiKey = '';
let setupWindow;
let mainWindow;

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
  setupWindow = new BrowserWindow(windowOptions({ width: 500, height: 610, resizable: false, title: '문항맵 설정' }));
  setupWindow.removeMenu();
  setupWindow.once('ready-to-show', () => setupWindow.show());
  void setupWindow.loadFile(path.join(__dirname, 'key-setup.html'));
}

function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow(windowOptions({ width: 1440, height: 920, minWidth: 1040, minHeight: 700, title: '문항맵' }));
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE_ORIGIN)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== SITE_ORIGIN) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  void mainWindow.loadURL(SITE_URL);
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

function finishSetup() {
  createMainWindow();
  setupWindow?.close();
  setupWindow = undefined;
}

ipcMain.handle('setup:set-api-key', (_event, value) => {
  const next = typeof value === 'string' ? value.trim() : '';
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(next)) return { ok: false, error: 'API 키 형식을 확인해 주세요.' };
  apiKey = next;
  finishSetup();
  return { ok: true };
});

ipcMain.handle('setup:skip-api-key', () => {
  apiKey = '';
  finishSetup();
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
          text: `이 이미지는 한국어 시험지의 한 페이지입니다. 아래 문항별로 이미지 원문을 확인해 텍스트 추출 오류를 교정하세요.\n\n${questions.map((question) => `${question.number}번: ${question.text}`).join('\n\n')}\n\n규칙:\n1. 원문에 실제로 보이는 수식, 숫자, 단위만 복원하고 추측하지 마세요.\n2. 수식과 과학 단위는 KaTeX 호환 LaTeX로 바꾸고 인라인은 $...$, 독립 수식은 $$...$$로 감싸세요.\n3. 문항에 딸린 그림, 그래프, 표, 회로, 지도 또는 자료 화면이 있으면 그 자료만 포함하는 사각형을 페이지 전체 기준 0~1 좌표 [x,y,width,height]로 반환하세요. 문제 지문과 선택지는 사각형에서 최대한 제외하세요.\n4. 그림자료가 없으면 hasFigure=false, figureBox=null입니다.\n5. 전달받은 모든 문항 번호를 한 번씩 반환하세요.`,
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
                  hasFigure: { type: 'boolean' },
                  figureBox: { anyOf: [{ type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 }, { type: 'null' }] },
                },
                required: ['number', 'latexText', 'hasFigure', 'figureBox'],
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
  createSetupWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createSetupWindow();
  });
});

app.on('window-all-closed', () => {
  apiKey = '';
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { apiKey = ''; });
