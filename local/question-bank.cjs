/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function questionSnapshot(value, fileName) {
  if (!value || !Number.isInteger(value.number) || value.number < 1 || value.number > 10000 || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 100) throw new Error('문항 번호 또는 신뢰도가 올바르지 않습니다.');
  const question = { number: value.number, confidence: value.confidence, sourceFileName: fileName };
  for (const key of ['type', 'text', 'standardCode', 'standard', 'domain']) {
    if (typeof value[key] !== 'string' || value[key].length > (key === 'text' ? 200000 : 3000)) throw new Error('문항 텍스트 또는 성취기준이 올바르지 않습니다.');
    question[key] = value[key];
  }
  if (!Array.isArray(value.questionCaptures) || !value.questionCaptures.length || value.questionCaptures.length > 40) throw new Error('저장할 문항 전체 캡처가 없습니다.');
  question.questionCaptures = value.questionCaptures.map((capture) => {
    const box = capture?.box;
    if (!Number.isInteger(capture?.page) || capture.page < 1 || capture.page > 200 || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.000001 || box[1] + box[3] > 1.000001 || typeof capture.image !== 'string' || capture.image.length > 15000000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(capture.image)) throw new Error('문항 캡처의 페이지·범위·이미지가 올바르지 않습니다.');
    return { page: capture.page, box: [...box], image: capture.image };
  });
  question.visionEnhanced = value.visionEnhanced === true;
  question.captureReviewed = value.captureReviewed === true;
  question.textEdited = value.textEdited === true;
  if(typeof value.analysisWarning==='string') question.analysisWarning=value.analysisWarning.slice(0,3000);
  if(value.visualChoices!==undefined) {
    if(!Array.isArray(value.visualChoices)||value.visualChoices.length>20) throw new Error('그림 선택지 목록이 올바르지 않습니다.');
    question.visualChoices=value.visualChoices.map(choice=>{
      if(typeof choice?.label!=='string'||!/^[①②③④⑤]$/.test(choice.label)) throw new Error('그림 선택지 번호가 올바르지 않습니다.');
      const checked=questionSnapshot({...value,visualChoices:undefined,questionCaptures:[choice]},fileName).questionCaptures[0];
      return {...checked,label:choice.label};
    });
  }
  if (typeof value.captureWarning === 'string') question.captureWarning = value.captureWarning.slice(0, 3000);
  return question;
}

function createQuestionBank(directory) {
  const root = path.resolve(directory);
  const recordPath = (id) => {
    if (!validId(id)) throw new Error('문제함 ID가 올바르지 않습니다.');
    return path.join(root, `${id}.jsonl`);
  };
  function atomicWrite(filename, value) {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, filename);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function list() {
    if (!fs.existsSync(root)) return [];
    // The first JSONL line is a lightweight index; do not load capture images
    // merely to list a large library. Index and content are one atomic file.
    const records = fs.readdirSync(root).filter((name) => /^[a-f0-9]{64}\.jsonl$/.test(name)).map((name) => {
      const descriptor = fs.openSync(path.join(root, name), 'r');
      const chunks = [];
      try {
        for (let offset = 0; offset < 2000000;) {
          const buffer = Buffer.alloc(65536);
          const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
          if (!length) break;
          const end = buffer.subarray(0, length).indexOf(10);
          chunks.push(buffer.subarray(0, end < 0 ? length : end));
          if (end >= 0) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
          offset += length;
        }
        throw new Error('문제함 목록 파일을 읽지 못했습니다. 저장 폴더의 원본 파일은 보존되어 있습니다.');
      } finally { fs.closeSync(descriptor); }
    });
    return records.flatMap((record) => record.items).sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.sourceFileName.localeCompare(b.sourceFileName, 'ko') || a.number - b.number);
  }
  function save(input) {
    if (typeof input?.sourceFileName !== 'string' || !input.sourceFileName.trim() || input.sourceFileName.length > 500 || !validId(input.sourceFingerprint) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 200) throw new Error('문제함에 저장할 PDF와 문항 정보가 올바르지 않습니다.');
    const fileName = input.sourceFileName.trim();
    const sourceId = digest(JSON.stringify([fileName, input.sourceFingerprint]));
    const savedAt = new Date().toISOString();
    const items = input.questions.map((value, index) => {
      const question = questionSnapshot(value, fileName);
      const id = `${sourceId}:${digest(JSON.stringify([question.number, index, question.questionCaptures.map(({ page, box }) => ({ page, box }))]))}`;
      return { id, savedAt, question };
    });
    const record = { version: 1, sourceId, sourceFileName: fileName, savedAt, items };
    if (Buffer.byteLength(JSON.stringify(record)) > 80000000) throw new Error('한 PDF의 저장 크기는 80MB 이하로 제한됩니다.');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const filename = recordPath(sourceId);
    const updated = fs.existsSync(filename);
    const summary = { items: items.map(({ id, question }) => ({ id, sourceFileName: fileName, savedAt, number: question.number, standardCode: question.standardCode, domain: question.domain, text: question.text.slice(0, 500), confidence: question.confidence })) };
    // Last explicit save of the same source replaces its whole snapshot; a
    // unique temp + rename prevents partial files even with multiple processes.
    atomicWrite(filename, `${JSON.stringify(summary)}\n${JSON.stringify(record)}`);
    return { saved: items.length, updated };
  }
  function select(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === 'string' && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(id))) throw new Error('1~200개 문항을 중복 없이 선택해 주세요.');
    const records = new Map();
    let size = 0;
    return ids.map((id) => {
      const sourceId = id.split(':')[0];
      if (!records.has(sourceId)) {
        const content = fs.readFileSync(recordPath(sourceId), 'utf8');
        records.set(sourceId, JSON.parse(content.slice(content.indexOf('\n') + 1)));
      }
      const item = records.get(sourceId).items.find((question) => question.id === id);
      if (!item) throw new Error('저장된 문항이 변경되었습니다. 문제함을 새로고침해 주세요.');
      size += Buffer.byteLength(JSON.stringify(item.question));
      if (size > 120000000) throw new Error('선택한 문항이 120MB를 넘습니다. 나누어 선택해 주세요.');
      return item.question;
    });
  }
  return { list, save, select };
}

module.exports = { createQuestionBank, questionSnapshot };
