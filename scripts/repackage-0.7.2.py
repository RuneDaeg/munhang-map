"""Repack the frozen 0.7.2 ZIP without rebuilding or changing its application."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / 'release/문항맵-로컬-0.7.2.zip'
target = root / 'release/munhang-map-local-0.7.2-windows.zip'
prefix = 'munhang-map-local-0.7.2/'
launcher = '''@echo off
setlocal
cd /d "%~dp0"
if not exist "server.cjs" (
  echo Extract ALL files from the ZIP before running START-WINDOWS.cmd.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  echo Install Node.js from https://nodejs.org then reopen this file.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22 || a===22 && b>=13 ? 0 : 1)"
if errorlevel 1 (
  echo Please update Node.js to version 22.13 or newer.
  pause
  exit /b 1
)
echo Starting Munhang Map 0.7.2. Keep this window open.
node server.cjs
if errorlevel 1 (
  echo Startup failed. Copy the error above when asking for help.
  pause
)
'''.replace('\n', '\r\n').encode('ascii')
readme = '''문항맵 0.7.2 - 윈도우 호환 재압축본

1. ZIP을 우클릭하여 '모두 압축 풀기'를 선택합니다.
2. https://nodejs.org 에서 Node.js 22.13 이상을 설치합니다.
3. 압축을 푼 폴더의 START-WINDOWS.cmd를 더블클릭합니다.
4. 브라우저가 열리지 않으면 검은 창에 나온 127.0.0.1 주소를 엽니다.
5. 사용하는 동안 검은 창을 닫지 않습니다.

ZIP 안에서 직접 실행하거나 renderer/index.html만 열지 마세요.
이 파일은 설치형 EXE가 아니라 Node.js가 필요한 로컬 실행판입니다.
압축 내부 경로를 영문으로 바꾸고 macOS 부가 파일을 제거했습니다.
앱 본체는 기존 0.7.2 그대로이며 수학·국어 신규 수정은 포함하지 않습니다.
API 키와 내 문제함은 이 ZIP에 포함되어 있지 않습니다.
Windows 실기기 실행은 이 Mac 환경에서 검증하지 못했습니다.
'''.encode('utf-8-sig')
manifest = {}
with ZipFile(source) as old, ZipFile(target, 'x', compression=ZIP_DEFLATED, compresslevel=9) as new:
    assert old.testzip() is None
    for entry in old.infolist():
        parts = entry.filename.split('/')
        if entry.is_dir() or parts[0] == '__MACOSX' or any(p.startswith('._') or p == '.DS_Store' for p in parts):
            continue
        relative = '/'.join(parts[1:])
        if relative.endswith('.bat') or relative.endswith('.command'):
            continue
        if relative.endswith('.txt') and len(parts) == 2:
            relative = 'USER-GUIDE-ORIGINAL.txt'
        assert relative and not relative.startswith('/') and '..' not in relative.split('/')
        assert relative.isascii(), relative
        data = old.read(entry)
        new.writestr(prefix + relative, data)
        manifest[relative] = hashlib.sha256(data).hexdigest()
    new.writestr(prefix + 'START-WINDOWS.cmd', launcher)
    new.writestr(prefix + 'README-WINDOWS.txt', readme)
with ZipFile(target) as check:
    assert check.testzip() is None
    for relative, sha in manifest.items():
        assert hashlib.sha256(check.read(prefix + relative)).hexdigest() == sha
    assert check.read(prefix + 'START-WINDOWS.cmd') == launcher
    assert not any('\n' in name or not name.isascii() for name in check.namelist())
print(json.dumps({'file':str(target),'applicationFilesByteIdentical':len(manifest),
  'crcCheck':'pass','windowsRuntimeTest':'not available on this Mac',
  'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))
