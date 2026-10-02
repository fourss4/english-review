# 영어회화 복습 PWA (프로토타입)

랭디 영어회화 수업의 녹음·코멘트·채팅을 가져와 Android에서 오프라인으로 복습하고,
AI로 OPIc IH 수준 표현을 추가 학습하는 개인용 모바일 웹앱입니다.

> 현재 상태: **M5 완료 (2026-10-02) — 휴대폰 설치 가능 단계**
> 가져오기, 수업 목록·상세·검색, 복습 카드(SM-2·문장 고치기·빈칸·Anki TSV), 녹음 플레이어(A-B 반복·구간 저장·쉐도잉),
> **오프라인 실행(서비스 워커), 홈 화면 설치, 전체 백업 ZIP 내보내기·복원, 업데이트 알림** 동작.
> 다음 단계: ① GitHub Pages 배포(직접 진행, `docs/github-pages-guide.md`) ② 06-1 녹음 텍스트 변환(STT)

## 확정된 사용 환경
| 항목 | 내용 |
|---|---|
| 기기 | Android Chrome, 홈 화면에 설치(PWA)해서 사용 |
| 입력 | 녹음 mp4 파일 선택 + 코멘트·채팅 텍스트 붙여넣기 |
| 저장 | 기기 내 IndexedDB, 오프라인 사용. 백업은 ZIP 내보내기/복원 |
| 배포 | GitHub Pages(공개 저장소)에 **앱 코드만** 배포. 수업 데이터는 올리지 않음 |
| 분량 | 주 2~3회, 회당 약 20분 녹음 |

## 주요 기능 (계획)
**기본 복습 (AI 불필요, 오프라인)**
- 표현 카드 영→한 / 한→영, 틀린 문장 직접 고치기, 빈칸 채우기, 객관식 — 간격반복(SM-2)
- 녹음 구간 반복(A-B), 속도 조절, 쉐도잉(내 목소리 녹음 비교), 채팅 검색
- 녹음 스크립트(STT)가 생기면 받아쓰기

**AI 표현 업그레이드 (ADR 0003)**
- 녹음 스크립트에서 OPIc IH 수준의 slang / idiom / 더 좋은 표현 **3개**를 설명·예시와 함께 제시
- 같은 요청으로 기존 표현·교정의 **한국어 뜻을 자동 채움**(랭디 원본은 영어만 제공)
- 연습 3종: ① 바꿔 말하기 드릴 ② 상황 → 표현 떠올리기 카드 ③ OPIc 미니 답변 챌린지
- 연동 방식: 앱이 만든 프롬프트를 원하는 AI 채팅에 붙여넣고, 결과 JSON을 앱에 다시 붙여넣기(API 키·서버 불필요, 공급자 교체 자유)
- 음성 파일은 AI에 보내지 않음. 보낼 텍스트는 미리보기·이름 마스킹 후 전송

## 진행 방법
Claude Code, Cowork 또는 다른 AI 코딩 도구에서 이 폴더를 열고 단계별로 지시합니다.
1. (완료) `docs/prompts/01-plan.md` — 계획 수립
2. `docs/prompts/02-to-08-next-steps.md`의 단계를 순서대로 하나씩 지시
   - 02 합성 샘플 → 03 가져오기 → 04 복습 카드 → 05 오디오·채팅 → 06 오프라인·백업 → 06-1 STT → 07 AI 표현 업그레이드 → 08 이관 점검
3. 배포: `docs/github-pages-guide.md` (가입 → 저장소 → 올리기 전 점검 → Pages 켜기 → Android 설치)

## 실행·테스트 (PC)
- 테스트: `node --test tests/*.test.mjs`
- 로컬 실행: `app` 폴더에서 `python -m http.server 8765` → 브라우저에서 http://localhost:8765
- Android에서 쓰려면 GitHub Pages 배포가 필요합니다(06 단계, `docs/github-pages-guide.md`).

## 주의
- `/init` 명령은 실행하지 마세요. 작성된 CLAUDE.md를 덮어쓸 수 있습니다.
- 실제 수업 데이터(녹음·채팅·강사 이름)는 `/data` 또는 `/private`에만 두세요(.gitignore 처리됨). GitHub 웹 업로드 시에는 .gitignore가 적용되지 않으니 직접 확인하세요.
- 다른 도구로 이관 시 AGENTS.md가 공통 규칙 파일입니다. CLAUDE.md는 이를 참조만 합니다.
- 랭디 약관에서 녹음 파일의 저장·가공 허용 범위를 확인하세요.
- OPIc IH 수준 판단은 AI의 일반 지식에 의존하며 공식 채점 기준과 일치를 보장하지 않습니다.

## 파일 구성
| 파일 | 용도 |
|---|---|
| AGENTS.md | 도구 공통 프로젝트 규칙 |
| CLAUDE.md | Claude Code용 진입점 (`@AGENTS.md`) |
| .gitignore | 실제 수업 데이터·자격증명 커밋 방지 |
| docs/plan.md | 구현 계획(아키텍처, 마일스톤, 위험, STT 비교, 확정 사항) |
| docs/data-spec.md | 데이터 명세(수업·카드·AI 생성물·백업 구조) |
| docs/decisions/ | 설계 결정 기록(ADR) — 0001 정적 PWA, 0002 AI 연동 방식, 0003 AI 표현 업그레이드, 0004 자체 ZIP 구현 |
| docs/github-pages-guide.md | GitHub 가입·배포 안내 |
| docs/sample-request.md | 익명화 샘플 준비 방법 |
| docs/sample-analysis.md | 랭디 원본 형식 분석·변환 규칙·결정 사항 |
| docs/prompts/01-plan.md | 첫 지시(계획 수립) |
| docs/prompts/02-to-08-next-steps.md | 이후 단계별 지시 |
| schema/*.json | 데이터 검증 규칙(JSON Schema) |
| app/index.html, app/css, app/js | 앱 본체(가져오기·목록·상세·휴지통) |
| app/js/parser/langdy-v1.js | 랭디 원본 → 표준 데이터 변환기 |
| app/js/cards.js, app/js/srs.js | 복습 카드 생성·동기화, SM-2 간격반복, Anki TSV |
| app/js/player.js, app/js/vtt.js | 녹음 플레이어·A-B 반복·구간 북마크(WebVTT)·쉐도잉 |
| app/js/search.js | 수업 전체 검색 |
| app/js/backup.js, app/js/zip.js, app/js/migrations.js | 백업 ZIP 만들기·복원(외부 라이브러리 없음, ADR 0004), 스키마 마이그레이션 |
| app/sw.js, app/manifest.webmanifest, app/icons/ | 오프라인 캐시, 홈 화면 설치 정보·아이콘 |
| docs/deploy/pages.yml | GitHub Pages 자동 배포 설정(저장소의 `.github/workflows/pages.yml`로 넣어야 함 — 안내서 4-1) |
| app/prompts/expression-upgrade.md | AI 표현 업그레이드 + 한국어 뜻 채우기 프롬프트 템플릿 |
| samples/ | 가상 샘플(원본 형식 + 변환 기대 결과) |
| tests/ | 변환기·카드·간격반복·VTT·검색·ZIP·백업·서비스 워커 테스트 (37개) |
| private/raw-samples/ | 익명화 샘플 넣는 곳(GitHub 업로드 제외) |
