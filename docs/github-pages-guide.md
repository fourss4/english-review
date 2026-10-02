# GitHub Pages 배포 안내 (개인 계정)

> 2026년 상반기 기준 정보입니다. GitHub 화면 구성이나 요금 정책은 바뀔 수 있으니 진행 시 GitHub 공식 문서(docs.github.com → Pages)를 함께 확인하세요.
> 배포는 직접 진행하시는 단계입니다. 아래 순서대로 하면 됩니다.

## 알아둘 점
- 무료(Free) 계정에서 GitHub Pages는 **공개(Public) 저장소**에서 사용합니다. 앱 코드는 누구나 볼 수 있습니다.
- 저장소에는 **앱 코드와 문서만** 올립니다. 녹음·코멘트·채팅·백업 ZIP·`private/` 폴더는 절대 올리지 않습니다.
- 배포 주소는 `https://<아이디>.github.io/<저장소이름>/` 입니다. 아이디에 실명이 드러나지 않게 정하는 것을 권합니다.
- 회사 계정·회사 이메일이 아닌 **개인 이메일**로 가입하는 것을 권합니다(개인 학습 프로젝트).
- 수업 데이터는 GitHub에 올라가지 않습니다. 앱을 열면 휴대폰 안(IndexedDB)에만 저장됩니다.

## 1. 가입
1. github.com → Sign up → 개인 이메일, 비밀번호, 아이디 → 이메일 인증
2. 2단계 인증(2FA) 설정 권장: Settings → Password and authentication

## 2. 저장소 만들기
1. 우측 상단 `+` → New repository
2. 이름 예: `english-review` / **Public** / README 추가 체크 해제 → Create repository

## 3. 올리기 전 점검 (꼭 확인)
Langdy 폴더에서 아래 항목이 **올라가지 않는지** 확인합니다.

| 올리면 안 됨 | 위치 |
|---|---|
| 실제 녹음(mp4/m4a), 코멘트·채팅 원문 | `private/`, `data/` |
| 백업 ZIP | `english-review-backup-*.zip` |
| `.env` 등 키 파일 | (현재 없음) |

- GitHub Desktop을 쓰면 `.gitignore` 덕분에 위 파일이 자동으로 빠집니다(권장).
- 웹 업로드는 `.gitignore`가 적용되지 않으므로 **올릴 폴더를 직접 고르세요**: `app/`, `docs/`, `schema/`, `samples/`, `tests/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`
- 배포 과정에서 `app/` 안에 녹음·ZIP 파일이 있으면 자동으로 배포가 중단되도록 해 두었습니다(2차 안전장치).

## 4. 코드 올리기 (둘 중 선택)
| 방법 | 설명 |
|---|---|
| GitHub Desktop (권장) | 설치 → File → Add local repository → Langdy 폴더 선택 → "create a repository" 안내가 나오면 생성 → Publish repository(**Keep this code private 체크 해제**) |
| 웹 업로드 | 저장소 화면 → Add file → Upload files → 위 3번의 폴더·파일만 끌어놓기 → Commit changes. 배포 설정 파일은 아래 4-1 참고 |

> 회사 PC에 GitHub Desktop 등 프로그램을 설치하는 것은 사내 IT 규정을 확인한 뒤 진행하세요.

## 4-1. 배포 설정 파일 넣기 (꼭 필요)
보안상 이 도구로는 `.github` 폴더에 직접 쓸 수 없어서, 배포 설정을 `docs/deploy/pages.yml`에 두었습니다. 둘 중 한 방법으로 저장소의 `.github/workflows/pages.yml` 위치에 넣어 주세요.
- **웹(가장 쉬움):** 저장소 → Add file → Create new file → 파일 이름 칸에 `.github/workflows/pages.yml` 입력 → `docs/deploy/pages.yml` 내용을 그대로 붙여넣기 → Commit changes
- **PC 탐색기:** Langdy 폴더에 `.github\workflows` 폴더를 만들고 `docs\deploy\pages.yml`을 복사한 뒤 GitHub Desktop으로 올리기

## 5. Pages 켜기
1. 저장소 → Settings → Pages
2. Build and deployment → Source: **GitHub Actions**
3. Actions 탭에서 "Deploy app to GitHub Pages"가 실행되는지 확인(처음 한 번은 Actions 탭에서 Run workflow로 직접 실행해도 됨)
4. 테스트(37개)가 통과하면 배포되고, 완료 화면에 주소가 나옵니다.

## 6. Android에 설치
1. Chrome에서 배포 주소 접속
2. 메뉴(⋮) → **앱 설치** 또는 **홈 화면에 추가**
3. 설치한 아이콘으로 실행 → 설정 탭에서 "오프라인 사용 준비됨" 확인
4. 비행기 모드에서 앱을 열어 동작 확인

## 7. 업데이트
- 코드를 다시 올리면 자동으로 다시 배포됩니다. 앱을 열면 "새 버전이 있습니다" 배너가 나오고, **지금 업데이트**를 누르면 교체됩니다.
- 배너가 안 나오면 설정 → 업데이트 확인.
- 앱 코드를 바꿀 때는 `app/js/version.js`와 `app/sw.js`의 버전을 함께 올려야 업데이트가 감지됩니다(테스트가 불일치를 잡아냄).

## 8. 백업 습관
- 휴대폰 저장소가 정리되거나 기기를 바꾸면 데이터가 사라질 수 있습니다. 설정 → **백업 ZIP 내보내기**를 주기적으로 하세요(14일이 지나면 복습 화면에 알림).
- 백업 ZIP은 개인 저장공간(휴대폰, 개인 클라우드)에만 보관합니다.
