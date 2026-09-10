#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "문항맵 로컬 실행에는 Node.js 22.13 이상이 필요합니다."
  echo "https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  read -r "?Enter 키를 누르면 닫힙니다. "
  exit 1
fi
if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)" >/dev/null 2>&1; then
  echo "설치된 Node.js 버전이 너무 낮습니다: $(node -v 2>/dev/null)"
  echo "https://nodejs.org 에서 22.13 이상 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  read -r "?Enter 키를 누르면 닫힙니다. "
  exit 1
fi
node server.cjs
munhang_exit_code=$?
if [ $munhang_exit_code -ne 0 ]; then
  echo "문항맵을 실행하지 못했습니다. 위 오류를 확인해 주세요."
  read -r "?Enter 키를 누르면 닫힙니다. "
fi
exit $munhang_exit_code
