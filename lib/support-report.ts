/** Creates local email drafts only. Neither helper sends or uploads any data. */
export const SUPPORT_EMAIL = 'rune_daeg@naver.com';
export const SUPPORT_ATTACHMENT_NAME = 'munhang-map-review.json';

const MIME_BOUNDARY = '=_munhang_map_support_review_v1_';
const CRLF = '\r\n';

function safeVersion(version: string) {
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(version) ? version : '알 수 없음';
}

function safeDetails(details: string) {
  // oxlint-disable-next-line no-control-regex -- Strip non-printable controls while preserving line breaks and tabs in the draft body.
  return Array.from(details.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')).slice(0, 4000).join('');
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  // Chunking avoids overflowing the argument stack for image-rich review JSON.
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

function encodedHeader(value: string) {
  // RFC 2047 encoded words must not exceed 75 characters or split a UTF-8 codepoint.
  const words: string[] = [];
  let word = '', length = 0;
  for (const char of value) {
    const bytes = new TextEncoder().encode(char).length;
    if (length + bytes > 42) {
      words.push(`=?UTF-8?B?${utf8Base64(word)}?=`);
      word = ''; length = 0;
    }
    word += char; length += bytes;
  }
  if (word) words.push(`=?UTF-8?B?${utf8Base64(word)}?=`);
  return words.join(`${CRLF} `);
}

function wrappedBase64(value: string) {
  return utf8Base64(value).match(/.{1,76}/g)?.join(CRLF) ?? '';
}

function subject(version: string) {
  return `[문항맵 v${safeVersion(version)}] 판독 오류 제보`;
}

function body(version: string, attachmentName: string, details: string, attached: boolean) {
  // oxlint-disable-next-line no-control-regex -- A filename reference must stay on a single human-readable body line.
  const name = attachmentName.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160).trim() || SUPPORT_ATTACHMENT_NAME;
  return [
    `문항맵 버전: ${safeVersion(version)}`,
    '',
    '문제 문항 번호와 잘못 인식된 내용을 적어 주세요.',
    safeDetails(details).trim() || '(오류 설명을 입력해 주세요.)',
    '',
    attached ? `검토 JSON 첨부 파일: ${SUPPORT_ATTACHMENT_NAME}` : `다운로드한 검토 JSON 파일(${name})을 직접 첨부해 주세요.`,
    '검토 JSON에는 문항 내용과 캡처 이미지 등이 포함될 수 있습니다.',
    '외부 유출이 금지된 시험지·개인정보가 없는지 확인한 뒤 직접 보내 주세요.',
    '이 기능은 메일 초안만 만들며 자동으로 전송하지 않습니다.',
  ].join(CRLF);
}

/** A small mailto draft. Document JSON never goes into the URL. */
export function buildSupportMailto(version: string, attachmentName: string, details = ''): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject(version))}&body=${encodeURIComponent(body(version, attachmentName, details, false))}`;
}

/**
 * A downloadable MIME email draft with a JSON attachment. Opening/editing .eml
 * drafts depends on the mail client; the UI must also offer manual attachment.
 */
export function buildSupportEml(version: string, reviewJson: string, details = ''): string {
  JSON.parse(reviewJson); // Fail clearly instead of labeling a corrupt payload as JSON.
  return [
    'X-Unsent: 1',
    `To: ${SUPPORT_EMAIL}`,
    `Subject: ${encodedHeader(subject(version))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${MIME_BOUNDARY}"`,
    '',
    `--${MIME_BOUNDARY}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrappedBase64(body(version, SUPPORT_ATTACHMENT_NAME, details, true)),
    `--${MIME_BOUNDARY}`,
    `Content-Type: application/json; name="${SUPPORT_ATTACHMENT_NAME}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${SUPPORT_ATTACHMENT_NAME}"`,
    '',
    wrappedBase64(reviewJson),
    `--${MIME_BOUNDARY}--`,
    '',
  ].join(CRLF);
}
