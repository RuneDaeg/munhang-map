/* oxlint-disable typescript/no-require-imports */
// release/문항맵-로컬 폴더를 배포용 ZIP으로 묶습니다.
// 파일 이름에 한글이 있으므로 UTF-8 플래그(general purpose bit 11)를 반드시 세웁니다.
// 이 플래그가 없으면 Windows 탐색기가 CP949로 읽어 "문항맵.bat" 같은 이름이 깨집니다.
// macOS 기본 `zip`은 -UN=UTF8을 지원하지 않으므로 직접 씁니다. 외부 의존성은 없습니다.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const projectRoot = path.resolve(__dirname, '..', '..');
const releaseDir = path.join(projectRoot, 'release');
const sourceDir = path.join(releaseDir, '문항맵-로컬');
const output = path.join(releaseDir, '문항맵-로컬.zip');

if (!fs.existsSync(sourceDir)) {
  console.error('release/문항맵-로컬 폴더가 없습니다. 먼저 pnpm local:package를 실행하세요.');
  process.exit(1);
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosDateTime(mtime) {
  const date = new Date(mtime);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function collect(directory, prefix, entries) {
  for (const name of fs.readdirSync(directory).sort()) {
    if (name === '.DS_Store') continue;
    const full = path.join(directory, name);
    const stats = fs.statSync(full);
    const arcname = `${prefix}${name}`;
    if (stats.isDirectory()) {
      entries.push({ arcname: `${arcname}/`, stats, directory: true });
      collect(full, `${arcname}/`, entries);
    } else {
      entries.push({ arcname, stats, directory: false });
    }
  }
  return entries;
}

const entries = collect(sourceDir, '문항맵-로컬/', [{ arcname: '문항맵-로컬/', stats: fs.statSync(sourceDir), directory: true }]);
const chunks = [];
const central = [];
let offset = 0;

for (const entry of entries) {
  const nameBytes = Buffer.from(entry.arcname, 'utf8');
  const raw = entry.directory ? Buffer.alloc(0) : fs.readFileSync(path.join(releaseDir, entry.arcname));
  const deflated = entry.directory ? Buffer.alloc(0) : zlib.deflateRawSync(raw, { level: 9 });
  // 압축이 오히려 커지면 무압축(store)으로 넣습니다.
  const stored = !entry.directory && deflated.length >= raw.length;
  const body = entry.directory ? Buffer.alloc(0) : (stored ? raw : deflated);
  const method = entry.directory || stored ? 0 : 8;
  const crc = entry.directory ? 0 : crc32(raw);
  const { time, day } = dosDateTime(entry.stats.mtime);
  const flags = 0x0800; // bit 11: 파일 이름이 UTF-8임

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBytes, body);

  const mode = entry.stats.mode & 0o7777;
  const typeBits = entry.directory ? 0o40000 : 0o100000;
  const externalAttributes = ((((typeBits | mode) << 16) | (entry.directory ? 0x10 : 0)) >>> 0);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(3 << 8 | 20, 4); // version made by: unix
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(flags, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(day, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(body.length, 20);
  header.writeUInt32LE(raw.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(externalAttributes, 38);
  header.writeUInt32LE(offset, 42);
  central.push(header, nameBytes);

  offset += local.length + nameBytes.length + body.length;
}

const centralBuffer = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);

fs.writeFileSync(output, Buffer.concat([...chunks, centralBuffer, end]));
console.log(`${output} (${entries.length}개 항목, ${(fs.statSync(output).size / 1024 / 1024).toFixed(1)}MB)`);
