# 영어회화 복습 PWA (프로토타입)

랭디 영어회화 수업의 녹음·코멘트·채팅을 **PC에서 한 번 정리**(녹음 → 텍스트, AI로 교정·표현·업그레이드 추출)해
휴대폰(Android)에서 오프라인으로 복습하는 개인용 앱입니다.

> 현재 상태: **v0.8.0 (2026-10-02)** — 배포 주소: https://fourss4.github.io/english-review/
> PC 수업 처리기(tools/, ADR 0006) + 앱 재설계(ADR 0007): 수업 패키지 가져오기, 표현 업그레이드 3개, AI 교정·표현,
> 빈칸·고르기·상황·뜻 문제 자동 채점, 오답 복습(다른 유형으로), 다음 수업 준비, OPIc 모의 답변, 주간 요약, 학습 기록 내보내기.

## 전체 흐름
```
[PC] private\inbox\<수업폴더>\  (녹음 mp4 + chat.txt + comment.txt)
   └─ tools\process.bat ─→ 녹음 → 텍스트(PC 안에서, faster-whisper)
                          → 이름·연락처 가림 → Claude API(교체 가능)로 교정·표현·업그레이드 3개·복습 문제 생성
                          → private\out\lesson-les_....zip
[휴대폰] 앱 → 가져오기 → ZIP 선택 → 오프라인 복습
```
- 녹음은 PC 밖으로 나가지 않습니다. AI에는 이름을 가린 **텍스트만** 보냅니다.
- AI 공급자는 `tools\config.toml`의 `provider`·`model`만 바꾸면 교체됩니다(anthropic / openai_compat / manual).
- PC 설치·사용법: **`tools/README.md`**

## 주요 기능 (앱)
| 구분 | 내용 |
|---|---|
| 수업 화면 | 녹음(속도·±5초), 스크립트(줄을 누르면 그 위치 재생), **표현 업그레이드 3개**(내가 한 말 → 슬랭·관용구·더 좋은 표현, 뜻·예문), 교정(AI가 대신 만든 칸은 "AI 생성" 표시), 표현, 항목별 "복습에서 빼기" |
| 복습 | 항목마다 문제 유형을 돌아가며 출제: 빈칸 채우기(짧은 표현만 입력), 옳은 것 고르기, 상황에 맞는 표현, 뜻·쓰임 떠올리기. 고르기·빈칸은 자동 채점 |
| 간격 | 처음 맞히면 어려움 1일 · 보통 3일 · 쉬움 5일, 이후 점점 길어짐(버튼마다 최소 1일 차이). 틀리면 오늘 다시 |
| 오답 복습 | 수업과 관계없이 틀린 항목만 모아 **마지막에 틀린 유형과 다른 유형**으로 다시 출제. 맞히면 오답 해제 |
| 추가 학습 | 다음 수업 준비 노트(써 볼 표현·물어볼 것), OPIc 모의 답변(질문·답변 구조·목표 표현·타이머), 주간 요약(PC에서 생성) |
| 데이터 | 학습 기록 내보내기/가져오기(JSON), Anki TSV, 검색, 휴지통 |
| 예비 입력 | PC를 쓸 수 없을 때 앱에서 직접 붙여넣기(기호 파싱 + AI 복사·붙여넣기) |

**백업을 없앤 이유(ADR 0007):** 수업 내용·녹음의 원본은 PC의 `private\archive`·패키지 ZIP이라 다시 가져오면 됩니다. 휴대폰에만 있는 것은 학습 기록뿐이라 그것만 내보냅니다.

**v0.7 이하에서 업데이트하면:** 기존 수업·카드는 앱이 처음 열릴 때 자동으로 새 형식으로 바뀌고 복습 기록(간격)은 이어집니다. 기존 수업에는 스크립트·업그레이드가 없으므로, 같은 수업을 PC 처리기로 다시 만들면 내용이 채워집니다(수업 ID가 다르면 새 수업으로 추가됨).

## 이 폴더를 새 PC에 다시 받았을 때
- GitHub Pages는 **GitHub 저장소에 올라간 코드로 동작**합니다. PC의 이 폴더는 코드를 고쳐 다시 올릴 때와 수업 처리기를 돌릴 때 필요합니다.
- 코드 안 경로는 모두 상대 경로라 폴더 위치는 어디든 됩니다.
- `.github/workflows/pages.yml`은 이미 저장소에 있습니다(사본: `docs/deploy/pages.yml`).

## 실행·테스트 (PC)
- 앱 테스트: `node --test tests/*.test.mjs` (Node 20 이상, 외부 패키지 없음, 51개)
- 처리기 테스트: `python -m unittest discover -s tools/tests -v` (14개, AI·음성 인식은 가짜로 대체)
- 로컬 실행: `app` 폴더에서 `python -m http.server 8765` → http://localhost:8765

## 업데이트 배포 방법
1. GitHub 저장소 → **Code** 탭 → **Add file → Upload files**
2. `app`, `docs`, `samples`, `schema`, `tests`, `tools`, `README.md`, `AGENTS.md`, `.gitignore` 를 끌어다 놓기
   - **`private` 폴더, `tools\.env`, `tools\config.toml` 은 올리지 않음** (웹 업로드에는 `.gitignore`가 적용되지 않음)
3. **Commit changes** → Actions 탭 초록 체크 확인 → 휴대폰 앱의 "새 버전" 배너에서 업데이트
- 자세한 안내: `docs/github-pages-guide.md`

## 주의
- 실제 수업 데이터(녹음·채팅·강사 이름)와 패키지 ZIP은 `private\`에만 두고 GitHub에 올리지 마세요.
- AI 결과(교정·업그레이드·OPIc 수준 판단)는 정확성을 보장하지 않습니다. "AI 생성" 표시는 선생님 확인 전 내용입니다.
- Claude API는 유료이며 사용량만큼 과금됩니다. 회사 PC라면 설치·외부 API 사용 전 사내 규정을 확인하세요.
- 랭디 약관에서 녹음 파일의 저장·가공 허용 범위를 확인하세요.
- `/init` 명령은 실행하지 마세요(CLAUDE.md 덮어씀). 다른 AI 도구로 이관할 때 공통 규칙은 AGENTS.md입니다.

## 파일 구성
| 파일 | 용도 |
|---|---|
| AGENTS.md / CLAUDE.md | AI 도구 공통 규칙 / Claude Code 진입점 |
| app/index.html, css, js/main.js | 앱 화면 |
| app/js/package.js | 수업 패키지 ZIP 읽기·검증(SHA-256·파일명·형식) |
| app/js/cards.js, srs.js | 학습 항목 카드·문제 선택·채점, 간격반복(srs2) |
| app/js/progress.js | 학습 기록 내보내기·합치기 |
| app/js/migrations.js | 수업 데이터 v1 → v2 변환 |
| app/js/player.js, vtt.js, search.js | 녹음 재생·시간 표기·검색 |
| app/js/parser/, ai-structure.js, app/prompts/ | 예비 직접 입력(기호 파싱·AI 복사·붙여넣기) |
| app/js/backup.js | 구버전 백업 형식(화면에서는 미사용, 테스트용으로 보존) |
| app/sw.js, manifest.webmanifest, icons/ | 오프라인 캐시·홈 화면 설치 |
| tools/ | PC 수업 처리기(Python): 음성 인식·AI 공급자·프롬프트·패키지 생성. 안내: tools/README.md |
| schema/*.json | 데이터 형식(lesson v2, card v2, package, weekly, progress / v1 보존) |
| docs/ | 계획, 데이터 명세, ADR 0001~0007, 배포 안내 |
| samples/ | 가상 샘플(원본 형식·v1/v2 수업·주간 요약) |
| tests/ | 앱 자동 테스트 |
| private/ | 실제 수업 데이터(inbox·out·archive). GitHub 업로드 금지 |
