/* oxlint-disable typescript/no-require-imports */
require('./load-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORT_EMAIL, SUPPORT_ATTACHMENT_NAME, buildSupportMailto, buildSupportEml } = require('../lib/support-report.ts');

function parseDraft(eml) {
  const boundary = eml.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/)[1];
  const pieces = eml.split(`--${boundary}`);
  const parts = pieces.slice(1, -1).map(piece => {
    const [headers, ...body] = piece.replace(/^\r\n/, '').split('\r\n\r\n');
    return { headers, encoded: body.join('\r\n\r\n').trim(), text: Buffer.from(body.join('\r\n\r\n').trim(), 'base64').toString('utf8') };
  });
  return { headers: pieces[0], parts, boundary };
}

test('EML is an unsent UTF-8 draft with the exact Korean review JSON attached', () => {
  const json = JSON.stringify({ fileName: '한국사.pdf', questions: [{ number: 13, text: '㉠ 사료 『자료』 $x_{1}$\n두 번째 줄 📝', image: 'data:image/png;base64,AA==' }] }, null, 2);
  const eml = buildSupportEml('0.7.15', json, '13번 사료 상자가 누락됩니다.');
  const { headers, parts } = parseDraft(eml);
  assert.match(headers, /^X-Unsent: 1\r\n/);
  assert.match(headers, new RegExp(`To: ${SUPPORT_EMAIL.replaceAll('.', '\\.')}\\r\\n`));
  assert.equal(parts.length, 2);
  assert.match(parts[0].headers, /text\/plain; charset=UTF-8/);
  assert.match(parts[0].text, /13번 사료 상자가 누락됩니다\./);
  assert.match(parts[0].text, /자동으로 전송하지 않습니다/);
  assert.match(parts[0].text, /외부 유출이 금지/);
  assert.match(parts[1].headers, /application\/json/);
  assert.match(parts[1].headers, new RegExp(`filename="${SUPPORT_ATTACHMENT_NAME}"`));
  assert.equal(parts[1].text, json);
  assert.deepEqual(JSON.parse(parts[1].text), JSON.parse(json));
  assert.equal(eml.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(eml.replaceAll('\r\n', '').includes('\r'), false);
});

test('MIME headers and boundaries cannot be injected through user strings', () => {
  const details = '설명\r\nBcc: attacker@example.com\r\n--=_munhang_map_support_review_v1_\r\nContent-Type: text/html';
  const json = JSON.stringify({ text: details });
  const eml = buildSupportEml('0.7.15\r\nBcc: attacker@example.com', json, details);
  const { headers, parts } = parseDraft(eml);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].text, json);
  assert.doesNotMatch(headers, /Bcc:|attacker/);
  assert.doesNotMatch(eml, /^Bcc:/m);
  assert.match(parts[0].text, /문항맵 버전: 알 수 없음/);
  assert.match(parts[0].text, /Bcc: attacker@example.com/);
});

test('base64 wraps at 76 columns and encoded subject words remain RFC 2047 sized', () => {
  const json = JSON.stringify({ text: '한글📝'.repeat(10000) });
  const eml = buildSupportEml('1234567890123456789012345678901234567890', json);
  const { headers, parts } = parseDraft(eml);
  for (const part of parts) {
    const lines = part.encoded.split('\r\n');
    for (const line of lines) assert.ok(line.length <= 76);
    for (const line of lines.slice(0, -1)) assert.equal(line.length, 76);
  }
  const words = headers.match(/=\?UTF-8\?B\?[^?]+\?=/g);
  assert.ok(words.length > 1);
  for (const word of words) assert.ok(word.length <= 75);
  const decodedSubject = words.map(word => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.equal(decodedSubject, '[문항맵 v1234567890123456789012345678901234567890] 판독 오류 제보');
  assert.equal(parts[1].text, json);
});

test('mailto encodes all fields, never adds an automatic attachment, and gives manual attachment instructions', () => {
  const url = new URL(buildSupportMailto('0.7.15', '한국사_검토.json', '1번 & 2번? a=b#c + 밑줄'));
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, SUPPORT_EMAIL);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['body', 'subject']);
  assert.equal(url.searchParams.get('subject'), '[문항맵 v0.7.15] 판독 오류 제보');
  assert.match(url.searchParams.get('body'), /한국사_검토\.json/);
  assert.match(url.searchParams.get('body'), /직접 첨부해 주세요/);
  assert.match(url.searchParams.get('body'), /1번 & 2번\? a=b#c \+ 밑줄/);
  assert.doesNotMatch(url.href, /data:image|"questions"|attachment=/);
  assert.equal(url.hash, '');
});

test('draft details are capped without splitting Unicode and attachment references cannot inject mailto fields', () => {
  const details = '📝'.repeat(4000) + '잘려야 하는 내용';
  const url = new URL(buildSupportMailto('0.7.15', '검토.json\r\n&bcc=attacker@example.com', details));
  assert.equal(url.searchParams.size, 2);
  assert.equal(url.searchParams.get('bcc'), null);
  assert.doesNotMatch(url.searchParams.get('body'), /잘려야 하는 내용|�/);
  assert.equal((url.searchParams.get('body').match(/📝/g) ?? []).length, 4000);
  const { parts } = parseDraft(buildSupportEml('0.7.15', '{}', details));
  assert.doesNotMatch(parts[0].text, /잘려야 하는 내용|�/);
});

test('malformed review JSON cannot be offered as a JSON attachment', () => {
  assert.throws(() => buildSupportEml('0.7.15', '{broken'), SyntaxError);
});

test('helpers have no network or global settings dependency', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../lib/support-report.ts'), 'utf8');
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|process\.env|api-key|settings\.json|smtp/i);
});
