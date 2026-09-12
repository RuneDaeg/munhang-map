/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const versioned=process.argv.includes('--versioned');
const version=require('../../package.json').version;
const output = path.join(projectRoot, 'release', versioned?`문항맵-로컬-${version}`:'문항맵-로컬');
if(versioned && fs.existsSync(output)) throw new Error('이미 같은 버전의 실행 폴더가 있습니다. 덮어쓰지 않았습니다.');
if(!versioned) fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(projectRoot, 'desktop', 'renderer-dist'), path.join(output, 'renderer'), { recursive: true });
for (const [source, target] of [
  ['local/server.cjs', 'server.cjs'],
  ['local/question-bank.cjs', 'question-bank.cjs'],
  ['local/release-check.cjs', 'release-check.cjs'],
  ['local/settings.html', 'settings.html'],
  ['local/문항맵.command', '문항맵.command'],
  ['local/문항맵.bat', '문항맵.bat'],
  ['local/사용법.txt', '사용법.txt'],
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
  ['desktop/provider-client.cjs', 'provider-client.cjs'],
]) {
  fs.copyFileSync(path.join(projectRoot, source), path.join(output, target));
}
fs.chmodSync(path.join(output, '문항맵.command'), 0o755);
console.log(output);
