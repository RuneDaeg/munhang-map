# 작업 지침

이 저장소에서 작업하는 AI 에이전트와 기여자를 위한 규칙입니다. 상세 사용법은 [README.md](./README.md)를 보세요.

## 이 프로젝트의 성격

교사용 로컬 도구입니다. **웹 호스팅 배포가 목표가 아닙니다.** 사용자는 ZIP을 받아 압축을 풀고 `문항맵.command`(Mac) 또는 `문항맵.bat`(Windows)을 실행해 `127.0.0.1`에서 씁니다.

- 실제 실행 경로는 `local/server.cjs`입니다.
- `app/`과 `.openai/hosting.json`은 `pnpm dev` 개발용으로 남아 있는 부분이며 배포본에 포함되지 않습니다.

## 배포: 태그를 밀면 릴리스에 올라갑니다

배포본 ZIP은 **저장소에 커밋하지 않습니다.** `release/`는 통째로 gitignore되어 있습니다.
`v*` 태그를 밀면 `.github/workflows/local-release.yml`이 빌드해서 릴리스에 첨부합니다.

```bash
# package.json의 version을 올린 뒤
git tag v0.5.2
git push origin v0.5.2
```

받는 분들은 저장소의 Releases 페이지에서 `munhang-map-local-*.zip`을 내려받습니다.
자산 이름을 ASCII로 두는 이유는 다운로드 링크가 깨지지 않게 하기 위해서이며,
압축을 풀면 폴더 이름은 그대로 `문항맵-로컬`입니다.

사용자에게 나가는 코드(`local/`, `desktop/`, `components/`, `lib/`, `public/`)를 고쳤다면
태그를 밀기 전에 로컬에서 배포본을 확인하세요.

```bash
pnpm local:release
```

`release/문항맵-로컬.zip`이 만들어집니다. 압축을 풀어 실제로 실행해 보는 것까지 권합니다.
브라우저를 띄우지 않고 확인하려면 `MUNHANG_NO_OPEN=1`, 개인 데이터 폴더를 건드리지 않으려면
`MUNHANG_DATA_DIR`을 임시 경로로 지정하세요.

워크플로는 릴리스에 붙이기 전에 ZIP을 검증합니다 — 필수 파일 존재 여부, 키·PDF 등 금지 파일
혼입 여부, 한글 이름의 UTF-8 플래그, `문항맵.command`의 실행 권한. 배포본 구성을 바꿨다면
`local-release.yml`의 검증 목록도 함께 갱신하세요.

데스크톱 설치 파일(DMG/EXE)은 `desktop-v*` 태그를 쓰는 `desktop-build.yml`이 따로 담당합니다.

## ZIP을 만들 때

**반드시 `pnpm local:zip`을 쓰세요. 터미널 `zip` 명령으로 직접 묶지 마세요.**

- macOS 기본 `zip`은 파일 이름에 UTF-8 플래그(general purpose bit 11)를 붙이지 않습니다. 그러면 Windows 탐색기가 CP949로 읽어 `문항맵.bat`·`사용법.txt`·폴더 이름이 전부 깨집니다. 이 `zip`은 `-UN=UTF8` 옵션도 지원하지 않습니다.
- `문항맵.command`의 실행 권한 `0755`가 보존돼야 합니다. 잃으면 Mac에서 더블클릭이 안 됩니다.
- `local/scripts/zip.cjs`가 두 가지를 모두 처리하며 외부 의존성이 없습니다.

수동으로 묶어야 한다면 macOS Finder의 "압축"을 쓰세요. Archive Utility는 UTF-8 플래그를 제대로 붙입니다.

## 배포본에 들어가면 안 되는 것

`local/scripts/package.cjs`는 **화이트리스트** 방식입니다. 명시된 파일만 복사되므로 개인 자료가 섞일 수 없습니다. 새 파일을 배포본에 넣어야 하면 이 목록에 추가하세요. 목록을 무시하고 폴더째 복사하는 방식으로 바꾸지 마세요.

절대 포함 금지: `.env*`, `api-key.enc`, `local-master-key.bin`, `settings.json`, `question-bank/`, 시험지 PDF, `*_검토.json`.

## 웹 호스팅을 되살릴 경우

`app/api/recognize/route.ts`에는 **인증도 레이트 리밋도 Origin 검사도 없습니다.** 호스팅 환경변수에 `OPENAI_API_KEY`를 넣고 배포하면 URL을 아는 누구나 소유자 계정으로 과금시킬 수 있습니다. 웹 배포를 하려면 접근 제어·요청 제한·공급자 측 사용 한도를 먼저 붙이세요.

같은 기능의 로컬 버전(`local/server.cjs`)에는 `127.0.0.1` 바인딩, Origin 검사, `sec-fetch-site` 검사, 단일 실행 잠금, 예산 추적이 모두 들어 있습니다. 참고하세요.

## 문서 동기화

- `local/사용법.txt` — 사용자용. **ZIP에 포함됩니다.**
- `README.md` — 개발자·빌드용. ZIP에 포함되지 않습니다.

사용자 눈에 보이는 동작을 바꿨다면 두 문서를 모두 확인하세요. 보안·개인정보 관련 안내는 특히 `사용법.txt`에도 반영해야 합니다. 배포본만 받은 분은 README를 볼 수 없습니다.

## 라이선스

문항맵 자체 코드는 MIT입니다([LICENSE](./LICENSE)). 제3자 자료 고지는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)에 있으며 두 파일 모두 배포 ZIP에 포함됩니다. 새 제3자 자료를 넣으면 고지도 함께 추가하세요.
