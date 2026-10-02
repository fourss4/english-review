# 프로젝트: 영어회화 복습 PWA (개인 학습용 프로토타입)

## 사용 환경 (확정)
- Android Chrome, 홈화면 설치 PWA. GitHub Pages(공개 저장소)로 앱 코드만 배포
- 입력: 녹음 mp4 파일 + 코멘트·채팅 텍스트 붙여넣기

## 목적
외부 영어회화 앱(랭디)의 수업 녹음·코멘트·채팅 이력을 가져와 복습/추가 학습하는
모바일 웹앱. 상시 서버 없음, 오프라인 사용, 도구/공급자 이관 가능.

## 불변 원칙
1. 서버리스: 백엔드 없이 정적 파일만으로 동작. 사용자 데이터는 기기(IndexedDB) 밖으로 전송 금지.
2. 이식성: 모든 데이터는 공개 표준 포맷으로 저장/내보내기
   (JSON + JSON Schema, Markdown, WebVTT, mp3/m4a, Anki 호환 TSV).
   특정 AI/클라우드/프레임워크 전용 포맷 금지.
3. 데이터 스키마가 곧 계약: `/docs/data-spec.md`와 `/schema/*.json`을 먼저 수정하고 코드를 맞춘다.
   `schemaVersion` 필드 필수, 마이그레이션 함수 유지.
4. 의존성 최소화: 바닐라 JS/TS 또는 경량 라이브러리만. 새 의존성은 존재·라이선스·취약점 확인 후
   `/docs/decisions/`(ADR)에 사유 기록.
5. 앱 본체는 LLM/STT API를 직접 호출하지 않는다. AI 표현 업그레이드(ADR 0003)는 "프롬프트 복사 → 결과 JSON 붙여넣기"(ADR 0002),
   대량 생성·STT는 선택형 CLI(`/tools`)로만 구현. API 키 하드코딩 금지, 환경변수 사용. 공급자는 인터페이스 뒤에 숨김.
6. 개인정보: 강사 실명·음성·채팅은 개인정보. 저장소에 실제 수업 데이터 커밋 금지(`.gitignore`),
   테스트는 `/samples`의 가상 데이터만 사용. 로그에 수업 내용 출력 금지.
7. 입력 포맷 가정 금지: 원본 파일 구조는 사용자가 제공하는 (익명화된) 샘플을 먼저 분석한 뒤 파서를 작성한다.

## 디렉터리 규칙
- `/app` 정적 PWA 소스
- `/schema` JSON Schema
- `/docs` data-spec.md, decisions/(ADR), prompts/(작업 지시 이력)
- `/samples` 가상(합성) 샘플 데이터만
- `/tools` 선택형 CLI (LLM 콘텐츠 생성 등)
- `/data`, `/private` 실제 수업 데이터 위치(커밋 금지)

## 작업 방식
- 큰 작업은 Plan 모드로 계획 → 승인 후 구현. 단계마다 테스트와 README 갱신.
- 완료 시 실행 방법, 한계(프로토타입, 운영 환경 아님), 잔여 보안 위험을 함께 기록.
- 머지/배포는 사람이 수행, AI 도구는 브랜치와 PR까지만.
- 문서(README, data-spec, ADR)는 다른 개발자나 다른 AI 도구가 이어받을 수 있는 수준으로 유지.
- 모호한 점은 한 번에 모아서 질문한다.

## 실행·테스트
- 테스트: `node --test tests/*.test.mjs` (Node 20 이상, 외부 패키지 없음)
- 로컬 실행: `app` 폴더에서 `python -m http.server 8765` → http://localhost:8765 (서비스 워커는 localhost/https에서만 동작)
- 배포: `.github/workflows/pages.yml`(원본 사본: `docs/deploy/pages.yml`) — main 브랜치 push 시 테스트 후 `app/`만 GitHub Pages로 배포. 배포 실행은 사람이 한다
- 앱 파일을 추가·삭제하면 `app/sw.js`의 ASSETS와 VERSION, `app/js/version.js`를 함께 갱신(테스트가 검사)
- 앱 CSP: 인라인 스크립트·eval 금지. 사용자 데이터는 textContent로만 출력

## 코드 보안
- 자격증명 하드코딩 금지
- 파일 업로드(ZIP 포함)는 크기/형식/경로(zip-slip) 검증
- 사용자 입력 및 가져온 텍스트는 HTML 이스케이프(XSS 방지), `innerHTML` 직접 사용 지양
- 외부 호출 범위 제한(앱 본체는 외부 네트워크 호출 없음)
- 동적 코드 실행(`eval`, `new Function`) 금지
