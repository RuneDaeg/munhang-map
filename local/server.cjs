/* oxlint-disable typescript/no-require-imports */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync, spawnSync } = require('node:child_process');
const providerClientPath = fs.existsSync(path.join(__dirname, 'provider-client.cjs'))
  ? path.join(__dirname, 'provider-client.cjs')
  : path.join(__dirname, '..', 'desktop', 'provider-client.cjs');
const { PROVIDERS, keyHint, normalizeConnection, providerInfo, recognize } = require(providerClientPath);

const HOST = '127.0.0.1';
const SETTINGS_FILE = path.join(dataDirectory(), 'settings.json');
const FALLBACK_SECRET_FILE = path.join(dataDirectory(), 'api-key.enc');
const FALLBACK_MASTER_FILE = path.join(dataDirectory(), 'local-master-key.bin');
const KEYCHAIN_SERVICE = 'kr.co.munhangmap.local-api';
const rendererRoot = fs.existsSync(path.join(__dirname, 'renderer'))
  ? path.join(__dirname, 'renderer')
  : path.join(__dirname, '..', 'desktop', 'renderer-dist');
const settingsHtml = path.join(__dirname, 'settings.html');
const state = loadState();
let runningRecognition = false;
let localOrigin = '';

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', localOrigin || `http://${HOST}`);
    if (request.method === 'GET' && url.pathname === '/api/recognize') return sendJson(response, 200, statusPayload());
    if (request.method === 'GET' && url.pathname === '/api/settings') return sendJson(response, 200, settingsPayload());
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      requireLocalOrigin(request);
      return await updateSettings(request, response);
    }
    if (request.method === 'POST' && url.pathname === '/api/usage/reset') {
      requireLocalOrigin(request);
      state.usage = emptyUsage();
      saveState();
      return sendJson(response, 200, statusPayload());
    }
    if (request.method === 'POST' && url.pathname === '/api/recognize') {
      requireLocalOrigin(request);
      return await runRecognition(request, response);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendText(response, 405, 'Method not allowed');
    if (url.pathname === '/settings.html') return sendFile(response, settingsHtml, request.method === 'HEAD');
    return serveRenderer(url.pathname, request.method === 'HEAD', response);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '로컬 서버 요청을 처리하지 못했습니다.';
    return sendJson(response, 400, { error: message });
  }
});

server.listen(0, HOST, () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  localOrigin = `http://${HOST}:${address.port}`;
  // Capturing and reviewing PDFs does not require an API connection.
  const url = `${localOrigin}/`;
  console.log(`\n문항맵 로컬 주소: ${url}`);
  console.log('이 창을 닫으면 문항맵도 종료됩니다.\n');
  openBrowser(url);
});

server.on('error', (reason) => {
  console.error('문항맵 로컬 서버를 시작하지 못했습니다.', reason);
  process.exitCode = 1;
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

async function updateSettings(request, response) {
  const input = await readJsonBody(request, 100_000);
  const current = await currentConnection();
  const connection = normalizeConnection(input, current);
  const nextHint = keyHint(connection);
  if (input.apiKey?.trim()) storeSecret(connection.apiKey);
  const identityChanged = state.connection?.provider !== connection.provider
    || state.connection?.model !== connection.model
    || state.connection?.keyHint !== nextHint;
  state.connection = {
    provider: connection.provider,
    model: connection.model,
    baseUrl: connection.baseUrl,
    budgetUsd: connection.budgetUsd,
    inputPrice: connection.inputPrice,
    outputPrice: connection.outputPrice,
    keyHint: nextHint,
  };
  if (identityChanged) state.usage = emptyUsage();
  saveState();
  return sendJson(response, 200, { ok: true, status: statusPayload() });
}

async function runRecognition(request, response) {
  if (runningRecognition) return sendJson(response, 429, { error: '이전 수식·그림 인식이 끝난 뒤 다시 시도해 주세요.' });
  const connection = await currentConnection();
  if (!connection) return sendJson(response, 503, { error: '먼저 API 연결을 설정해 주세요.' });
  runningRecognition = true;
  try {
    const body = await readJsonBody(request, 8_000_000);
    const output = await recognize(connection, body);
    recordUsage(connection, output.usage);
    return sendJson(response, 200, output.result);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '비전 분석을 완료하지 못했습니다.';
    return sendJson(response, 502, { error: message });
  } finally {
    runningRecognition = false;
  }
}

async function currentConnection() {
  if (!state.connection) return null;
  const apiKey = loadSecret();
  try {
    return normalizeConnection({ ...state.connection, apiKey }, null);
  } catch {
    return null;
  }
}

function statusPayload() {
  const connection = state.connection;
  const hasSecret = Boolean(loadSecret());
  const available = Boolean(connection && (hasSecret || (connection.provider === 'compatible' && isLoopback(connection.baseUrl))));
  const usage = normalizedUsage(state.usage);
  const budgetUsd = numberOrNull(connection?.budgetUsd);
  return {
    available,
    local: true,
    desktop: false,
    provider: connection?.provider || '',
    providerLabel: providerInfo(connection?.provider)?.label || '',
    model: connection?.model || '',
    keyHint: connection?.keyHint || '',
    storageLabel: secretStorageLabel(),
    usage,
    budgetUsd,
    estimatedRemainingUsd: budgetUsd === null ? null : Math.max(0, budgetUsd - usage.estimatedUsd),
    balanceSource: 'local_estimate',
    settingsUrl: '/settings.html',
  };
}

function settingsPayload() {
  return {
    status: statusPayload(),
    connection: state.connection ? {
      provider: state.connection.provider,
      model: state.connection.model,
      baseUrl: state.connection.baseUrl,
      budgetUsd: state.connection.budgetUsd,
      inputPrice: state.connection.inputPrice,
      outputPrice: state.connection.outputPrice,
    } : null,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, info]) => [id, {
      label: info.label,
      defaultModel: info.defaultModel,
      defaultInputPrice: info.defaultInputPrice,
      defaultOutputPrice: info.defaultOutputPrice,
    }])),
  };
}

function recordUsage(connection, usage) {
  const inputTokens = Number(usage?.inputTokens || 0);
  const outputTokens = Number(usage?.outputTokens || 0);
  state.usage = normalizedUsage({
    requests: Number(state.usage?.requests || 0) + 1,
    inputTokens: Number(state.usage?.inputTokens || 0) + inputTokens,
    outputTokens: Number(state.usage?.outputTokens || 0) + outputTokens,
    estimatedUsd: Number(state.usage?.estimatedUsd || 0)
      + (inputTokens / 1_000_000) * Number(connection.inputPrice || 0)
      + (outputTokens / 1_000_000) * Number(connection.outputPrice || 0),
  });
  saveState();
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { version: 1, connection: parsed.connection || null, usage: normalizedUsage(parsed.usage) };
  } catch {
    return { version: 1, connection: null, usage: emptyUsage() };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, SETTINGS_FILE);
  fs.chmodSync(SETTINGS_FILE, 0o600);
}

function loadSecret() {
  if (process.platform === 'darwin') {
    try {
      return execFileSync('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  }
  return loadFallbackSecret();
}

function storeSecret(value) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/security', [
      'add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w', value,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) throw new Error('macOS 키체인에 API 키를 저장하지 못했습니다.');
    return;
  }
  storeFallbackSecret(value);
}

function loadFallbackSecret() {
  try {
    const key = fs.readFileSync(FALLBACK_MASTER_FILE);
    const payload = JSON.parse(fs.readFileSync(FALLBACK_SECRET_FILE, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function storeFallbackSecret(value) {
  const key = loadOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const payload = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
  fs.writeFileSync(FALLBACK_SECRET_FILE, JSON.stringify(payload), { mode: 0o600 });
}

function loadOrCreateMasterKey() {
  try {
    const key = fs.readFileSync(FALLBACK_MASTER_FILE);
    if (key.length === 32) return key;
  } catch {
    // Create a new local key below.
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(FALLBACK_MASTER_FILE, key, { mode: 0o600 });
  return key;
}

function secretStorageLabel() {
  return process.platform === 'darwin' ? 'macOS 키체인' : '사용자 전용 로컬 암호화 파일';
}

function dataDirectory() {
  if (process.env.MUNHANG_DATA_DIR) return path.resolve(process.env.MUNHANG_DATA_DIR);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', '문항맵-로컬');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), '문항맵-로컬');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'munhang-map-local');
}

function requireLocalOrigin(request) {
  if (request.headers.origin !== localOrigin) throw new Error('문항맵 로컬 화면에서 보낸 요청만 허용됩니다.');
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('요청 데이터가 너무 큽니다.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('요청 내용을 읽지 못했습니다.'));
      }
    });
    request.on('error', reject);
  });
}

function serveRenderer(pathname, headOnly, response) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.resolve(rendererRoot, requested);
  const root = path.resolve(rendererRoot);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return sendText(response, 403, 'Forbidden');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return sendFile(response, candidate, headOnly);
  return sendFile(response, path.join(root, 'index.html'), headOnly);
}

function sendFile(response, filename, headOnly) {
  if (!fs.existsSync(filename)) return sendText(response, 404, 'Not found');
  const extension = path.extname(filename).toLowerCase();
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.csv': 'text/csv; charset=utf-8',
  }[extension] || 'application/octet-stream';
  response.writeHead(200, securityHeaders({ 'Content-Type': type, 'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600' }));
  if (headOnly) return response.end();
  fs.createReadStream(filename).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }));
  response.end(text);
}

function securityHeaders(extra) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:",
    ...extra,
  };
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

function isLoopback(value) {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.env.MUNHANG_NO_OPEN === '1') return;
  if (process.platform === 'darwin') execFile('/usr/bin/open', [url]);
  else if (process.platform === 'win32') execFile('cmd.exe', ['/c', 'start', '', url]);
  else execFile('xdg-open', [url]);
}
