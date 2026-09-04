/* oxlint-disable typescript/no-require-imports */
const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { keyHint, normalizeConnection, providerInfo, recognize } = require('./provider-client.cjs');

const APP_SCHEME = 'munhang';
const APP_HOST = 'app';
const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const RENDERER_DIR = path.join(__dirname, 'renderer-dist');
let state = { version: 1, connection: null, usage: emptyUsage() };
let setupWindow;
let mainWindow;

function storedStatePath() {
  return path.join(app.getPath('userData'), 'ai-connection.bin');
}

function legacyKeyPath() {
  return path.join(app.getPath('userData'), 'openai-api-key.bin');
}

function loadStoredState() {
  if (!safeStorage.isEncryptionAvailable()) return { version: 1, connection: null, usage: emptyUsage() };
  try {
    const value = safeStorage.decryptString(fs.readFileSync(storedStatePath()));
    const parsed = JSON.parse(value);
    if (!parsed?.connection) throw new Error('empty');
    return { version: 1, connection: normalizeConnection(parsed.connection), usage: normalizedUsage(parsed.usage) };
  } catch {
    try {
      const legacyKey = safeStorage.decryptString(fs.readFileSync(legacyKeyPath()));
      const connection = normalizeConnection({ provider: 'openai', apiKey: legacyKey });
      const migrated = { version: 1, connection, usage: emptyUsage() };
      storeState(migrated);
      return migrated;
    } catch {
      return { version: 1, connection: null, usage: emptyUsage() };
    }
  }
}

function storeState(value = state) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 컴퓨터에서 API 연결 보안 저장소를 사용할 수 없습니다.');
  }
  fs.mkdirSync(path.dirname(storedStatePath()), { recursive: true });
  fs.writeFileSync(storedStatePath(), safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
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
  setupWindow = new BrowserWindow(windowOptions({ width: 620, height: 850, minWidth: 540, minHeight: 720, resizable: true, title: '문항맵 API 연결' }));
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

ipcMain.handle('setup:set-connection', (_event, value) => {
  try {
    const connection = normalizeConnection(value, state.connection);
    const identityChanged = state.connection?.provider !== connection.provider
      || state.connection?.model !== connection.model
      || keyHint(state.connection) !== keyHint(connection);
    state = { version: 1, connection, usage: identityChanged ? emptyUsage() : normalizedUsage(state.usage) };
    storeState();
    finishSetup();
    return { ok: true, status: statusPayload() };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : 'API 연결을 안전하게 저장하지 못했습니다.' };
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

ipcMain.handle('vision:status', () => statusPayload());

ipcMain.handle('vision:recognize', async (_event, body) => {
  if (!state.connection) return { error: '먼저 API 연결을 설정해 주세요.' };
  try {
    const output = await recognize(state.connection, body);
    recordUsage(output.usage);
    return output.result;
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : '비전 분석을 완료하지 못했습니다.' };
  }
});

function statusPayload() {
  const connection = state.connection;
  const usage = normalizedUsage(state.usage);
  const budgetUsd = numberOrNull(connection?.budgetUsd);
  return {
    available: Boolean(connection),
    model: connection?.model || '',
    desktop: true,
    local: true,
    provider: connection?.provider || '',
    providerLabel: providerInfo(connection?.provider)?.label || '',
    keyHint: connection ? keyHint(connection) : '',
    baseUrl: connection?.baseUrl || '',
    inputPrice: numberOrNull(connection?.inputPrice),
    outputPrice: numberOrNull(connection?.outputPrice),
    storageLabel: '운영체제 보안 저장소',
    usage,
    budgetUsd,
    estimatedRemainingUsd: budgetUsd === null ? null : Math.max(0, budgetUsd - usage.estimatedUsd),
    balanceSource: 'local_estimate',
  };
}

function recordUsage(usage) {
  const inputTokens = Number(usage?.inputTokens || 0);
  const outputTokens = Number(usage?.outputTokens || 0);
  state.usage = normalizedUsage({
    requests: Number(state.usage?.requests || 0) + 1,
    inputTokens: Number(state.usage?.inputTokens || 0) + inputTokens,
    outputTokens: Number(state.usage?.outputTokens || 0) + outputTokens,
    estimatedUsd: Number(state.usage?.estimatedUsd || 0)
      + (inputTokens / 1_000_000) * Number(state.connection?.inputPrice || 0)
      + (outputTokens / 1_000_000) * Number(state.connection?.outputPrice || 0),
  });
  storeState();
}

function normalizedUsage(value) {
  return {
    requests: Math.max(0, Math.round(Number(value?.requests || 0))),
    inputTokens: Math.max(0, Math.round(Number(value?.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(Number(value?.outputTokens || 0))),
    estimatedUsd: Math.max(0, Number(Number(value?.estimatedUsd || 0).toFixed(6))),
  };
}

function emptyUsage() {
  return { requests: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
}

function numberOrNull(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number) ? null : number;
}

void app.whenReady().then(() => {
  registerAppProtocol();
  state = loadStoredState();
  if (state.connection) createMainWindow();
  else createSetupWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) {
      if (state.connection) createMainWindow();
      else createSetupWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { state = { version: 1, connection: null, usage: emptyUsage() }; });
