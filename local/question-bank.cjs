/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validItemId = (value) => typeof value === 'string' && /^[a-f0-9]{64}:[a-f0-9]{64}$/.test(value);
const sourceBasename = (value) => (value.split(/[\\/]/).pop() || '').replace(/[\p{Cc}\p{Cf}:*?"<>|]/gu, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 500);

function questionSnapshot(value, fileName) {
  if (!value || !Number.isInteger(value.number) || value.number < 1 || value.number > 10000 || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 100) throw new Error('문항 번호 또는 신뢰도가 올바르지 않습니다.');
  const question = { number: value.number, confidence: value.confidence, sourceFileName: fileName };
  const hwpx = value.sourceFormat === 'hwpx' && validId(value.sourceFingerprint);
  if (value.sourceFormat === 'hwpx' && !hwpx) throw new Error('HWPX 원본 정보가 올바르지 않습니다.');
  if (typeof value.answer === 'string' && value.answer.length <= 500) question.answer = value.answer;
  else if (value.answer !== undefined) throw new Error('정답은 500자 이하의 텍스트로 입력해 주세요.');
  if (typeof value.answerSource === 'string' && sourceBasename(value.answerSource)) question.answerSource = sourceBasename(value.answerSource);
  if (typeof value.sourceItemId === 'string' && value.sourceItemId.trim() && value.sourceItemId.length <= 200) question.sourceItemId = value.sourceItemId.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
  if (value.explanation !== undefined) {
    if (typeof value.explanation !== 'string' || value.explanation.length > 200000) throw new Error('해설은 20만 자 이하의 텍스트로 저장해 주세요.');
    question.explanation = value.explanation;
  }
  if (value.sourceFormat === 'pdf') question.sourceFormat = 'pdf';
  if (hwpx) {
    question.sourceFormat = 'hwpx'; question.sourceFingerprint = value.sourceFingerprint;
    if ((value.questionCaptures !== undefined && (!Array.isArray(value.questionCaptures) || value.questionCaptures.length)) || (value.visualChoices !== undefined && (!Array.isArray(value.visualChoices) || value.visualChoices.length))) throw new Error('HWPX 삽입 그림은 원본 페이지 캡처로 저장할 수 없습니다.');
    for (const field of ['sourceImages', 'explanationImages']) if (value[field] !== undefined) {
      if (!Array.isArray(value[field]) || value[field].length > 40) throw new Error('HWPX 삽입 그림 목록이 올바르지 않습니다.');
      let total = 0;
      const seen = new Set();
      question[field] = value[field].map(image => {
        if (!image || typeof image.id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(image.id) || image.id === '.' || image.id === '..' || seen.has(image.id)
          || typeof image.image !== 'string' || image.image.length > 15000000 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.image) || image.image.slice(image.image.indexOf(',') + 1).length % 4) throw new Error('HWPX 삽입 그림 정보가 올바르지 않습니다.');
        total += image.image.length; if (total > 40000000) throw new Error('HWPX 삽입 그림은 문항당 40MB 이하로 저장해 주세요.');
        seen.add(image.id);
        return { id: image.id, image: image.image, ...(typeof image.label === 'string' ? { label: image.label.slice(0, 200) } : {}) };
      });
    }
  }
  if (Number.isInteger(value.sourceQuestionNumber) && value.sourceQuestionNumber >= 1 && value.sourceQuestionNumber <= 10000) question.sourceQuestionNumber = value.sourceQuestionNumber;
  if (value.sourceQuestionLabel !== undefined) {
    if (typeof value.sourceQuestionLabel !== 'string' || !/^[\p{L}][^#<>\p{Cc}\p{Cf}\uE000-\uF8FF\uFFFD]{0,79}$/u.test(value.sourceQuestionLabel)) throw new Error('도서 원문 문항 라벨이 올바르지 않습니다.');
    if (question.sourceQuestionNumber !== undefined) throw new Error('원본 문항 번호와 비숫자 라벨이 함께 지정되어 있습니다.');
    question.sourceQuestionLabel = value.sourceQuestionLabel;
  }
  if (value.sourceBookMetadata !== undefined) {
    const metadata = value.sourceBookMetadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('도서 원문 식별정보가 올바르지 않습니다.');
    const safe = {};
    for (const key of ['unit', 'category', 'page', 'questionLabel']) {
      if (metadata[key] === undefined) continue;
      if (typeof metadata[key] !== 'string' || !metadata[key].length || metadata[key].length > 80 || /[#<>\p{Cc}\p{Cf}\uE000-\uF8FF\uFFFD]/u.test(metadata[key])) throw new Error('도서 원문 식별정보가 올바르지 않습니다.');
      safe[key] = metadata[key];
    }
    if (!safe.questionLabel || !!safe.unit === !!safe.category) throw new Error('도서 원문 단원·문항 라벨이 올바르지 않습니다.');
    question.sourceBookMetadata = safe;
  }
  if (typeof value.sectionLabel === 'string' && value.sectionLabel.trim()) question.sectionLabel = value.sectionLabel.replace(/[\r\n\t]/g, ' ').trim().slice(0, 200);
  for (const key of ['type', 'text', 'standardCode', 'standard', 'domain']) {
    if (typeof value[key] !== 'string' || value[key].length > (key === 'text' ? 200000 : 3000)) throw new Error('문항 텍스트 또는 성취기준이 올바르지 않습니다.');
    question[key] = value[key];
  }
  if (!hwpx && (!Array.isArray(value.questionCaptures) || !value.questionCaptures.length || value.questionCaptures.length > 40)) throw new Error('저장할 문항 전체 캡처가 없습니다.');
  question.questionCaptures = (value.questionCaptures || []).map((capture) => {
    const box = capture?.box;
    if (!Number.isInteger(capture?.page) || capture.page < 1 || capture.page > 200 || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1.000001 || box[1] + box[3] > 1.000001 || typeof capture.image !== 'string' || capture.image.length > 15000000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(capture.image)) throw new Error('문항 캡처의 페이지·범위·이미지가 올바르지 않습니다.');
    return { page: capture.page, box: [...box], image: capture.image };
  });
  question.visionEnhanced = value.visionEnhanced === true;
  question.captureReviewed = value.captureReviewed === true;
  question.textEdited = value.textEdited === true;
  if(typeof value.analysisWarning==='string') question.analysisWarning=value.analysisWarning.slice(0,3000);
  if(typeof value.assessmentText==='string' && value.assessmentText.length<=200000) question.assessmentText=value.assessmentText;
  for(const key of ['mappingArea','mappingReason']) if(typeof value[key]==='string') question[key]=value[key].slice(0,3000);
  const shared=value.sharedPassage;
  if(shared && Array.isArray(shared.range) && shared.range.length===2 && shared.range.every(n=>Number.isInteger(n)&&n>=1&&n<=200) && shared.range[0]<=shared.range[1]
    && typeof shared.text==='string' && shared.text.length<=200000 && Array.isArray(shared.pages) && shared.pages.length>0 && shared.pages.length<=200 && shared.pages.every(p=>Number.isInteger(p)&&p>=1&&p<=200))
    question.sharedPassage={range:[...shared.range],text:shared.text,pages:[...new Set(shared.pages)]};
  if(Array.isArray(value.validationFlags)) question.validationFlags=value.validationFlags.slice(0,30).flatMap(f=>
    f && typeof f.code==='string' && /^[a-z_]{1,60}$/.test(f.code) && typeof f.message==='string' ? [{code:f.code,message:f.message.slice(0,3000)}] : []);
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
  function locked(sourceId, action) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const lock = `${recordPath(sourceId)}.lock`;
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`같은 원본 파일의 저장 작업이 진행 중이거나 이전 저장이 중단되었습니다. 다른 창의 저장 완료 후 다시 시도해 주세요. 계속 반복되면 초안을 복사하고 문항맵 실행 창을 모두 닫은 뒤 아래 .lock 파일만 삭제해 주세요. .jsonl 문항 파일은 삭제하지 마세요.\n${lock}`);
      throw error;
    }
    try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return action(); }
    finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
  }
  function readRecord(sourceId) {
    const content = fs.readFileSync(recordPath(sourceId), 'utf8');
    return JSON.parse(content.slice(content.indexOf('\n') + 1));
  }
  function writeRecord(record) {
    if (Buffer.byteLength(JSON.stringify(record)) > 80000000) throw new Error('한 원본 파일의 저장 크기는 80MB 이하로 제한됩니다.');
    const summary = { items: record.items.map(({ id, savedAt, question }) => ({ id, sourceFileName: record.sourceFileName, savedAt, number: question.number, sourceQuestionNumber: question.sourceQuestionNumber, sourceQuestionLabel: question.sourceQuestionLabel, sectionLabel: question.sectionLabel, standardCode: question.standardCode, domain: question.domain, text: question.text.slice(0, 500), confidence: question.confidence })) };
    atomicWrite(recordPath(record.sourceId), `${JSON.stringify(summary)}\n${JSON.stringify(record)}`);
  }
  function getItem(id) {
    if (!validItemId(id)) throw new Error('문제함 ID가 올바르지 않습니다.');
    const record = readRecord(id.split(':')[0]);
    const item = record.items.find(value => value.id === id);
    if (!item) throw new Error('저장된 문항이 변경되었습니다. 문제함을 새로고침해 주세요.');
    return { record, item };
  }
  function inspect(id) {
    const { item } = getItem(id);
    return { id, revision: digest(JSON.stringify(item)), savedAt: item.savedAt, question: item.question };
  }
  function update(input) {
    if (!validItemId(input?.id) || !validId(input.revision) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 200000) throw new Error('수정할 문항 ID·텍스트·저장 버전이 올바르지 않습니다.');
    if (input.answer !== undefined && (typeof input.answer !== 'string' || input.answer.length > 500)) throw new Error('정답은 500자 이하의 텍스트로 입력해 주세요.');
    return locked(input.id.split(':')[0], () => {
      const { record, item } = getItem(input.id);
      if (digest(JSON.stringify(item)) !== input.revision) throw new Error('다른 창에서 이 문항을 수정했거나 같은 원본 파일을 다시 저장했습니다. 초안을 복사해 둔 뒤 문항을 다시 불러와 주세요. 덮어쓰지 않았습니다.');
      const textChanged = input.text !== item.question.text;
      const question = questionSnapshot({ ...item.question, text: input.text, ...(input.answer !== undefined ? { answer: input.answer } : {}), ...(textChanged ? { textEdited: true, visionEnhanced: false } : {}) }, record.sourceFileName);
      // These conclusions describe the old text, not the teacher's new edit.
      if (textChanged) {
        delete question.assessmentText;
        delete question.mappingReason;
        delete question.validationFlags;
      }
      item.question = question;
      item.savedAt = new Date().toISOString();
      record.savedAt = item.savedAt;
      writeRecord(record);
      return { id: item.id, revision: digest(JSON.stringify(item)), savedAt: item.savedAt, question };
    });
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
    if (typeof input?.sourceFileName !== 'string' || !input.sourceFileName.trim() || input.sourceFileName.length > 500 || !validId(input.sourceFingerprint) || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 1000) throw new Error('문제함에 저장할 파일과 문항 정보가 올바르지 않습니다.');
    if (input.questions.length > 200 && !input.questions.every(question => question?.sourceFormat === 'hwpx' && question.sourceFingerprint === input.sourceFingerprint)) throw new Error('PDF는 한 번에 200문항까지 저장할 수 있습니다.');
    const fileName = sourceBasename(input.sourceFileName);
    if (!fileName) throw new Error('원본 파일 이름이 올바르지 않습니다.');
    const sourceId = digest(JSON.stringify([fileName, input.sourceFingerprint]));
    const savedAt = new Date().toISOString();
    const items = input.questions.map((value, index) => {
      const question = questionSnapshot(value, fileName);
      if (question.sourceFormat === 'hwpx' && question.sourceFingerprint !== input.sourceFingerprint) throw new Error('HWPX 원본 정보가 일치하지 않습니다.');
      const id = `${sourceId}:${digest(JSON.stringify(question.sourceItemId ? ['item', question.sourceItemId] : [question.number, index, question.questionCaptures.map(({ page, box }) => ({ page, box }))]))}`;
      return { id, savedAt, question };
    });
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('원본 문항 코드가 중복되어 문제함에 저장하지 않았습니다.');
    const record = { version: 1, sourceId, sourceFileName: fileName, savedAt, items };
    if (Buffer.byteLength(JSON.stringify(record)) > 80000000) throw new Error('한 원본 파일의 저장 크기는 80MB 이하로 제한됩니다.');
    // Last explicit save of the same source replaces its whole snapshot; a
    // unique temp + rename prevents partial files even with multiple processes.
    return locked(sourceId, () => {
      const updated = fs.existsSync(recordPath(sourceId));
      writeRecord(record);
      return { saved: items.length, updated };
    });
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
  return { list, save, select, inspect, update };
}

module.exports = { createQuestionBank, questionSnapshot };
