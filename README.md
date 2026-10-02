# PC 수업 처리기 사용 안내

수업 녹음·채팅·코멘트를 PC에서 한 번에 처리해 휴대폰 앱이 읽는 **수업 패키지(ZIP)** 를 만듭니다.
녹음은 PC 안에서 텍스트로 바뀌고 외부로 나가지 않습니다. AI(Claude)에는 이름을 가린 텍스트만 보냅니다.

## 1. 처음 한 번 설치 (약 10~20분)

1. **Python 3.11 이상** 설치: https://www.python.org/downloads/ → 설치 화면 첫 페이지에서 **"Add python.exe to PATH" 체크**
2. **ffmpeg** 설치(선택, 권장): PowerShell에서 `winget install Gyan.FFmpeg`
3. Langdy 폴더의 `tools\setup.bat` 더블클릭
   - 가상환경은 OneDrive 밖(`%LOCALAPPDATA%\langdy-processor`)에 만들어 동기화 용량을 차지하지 않습니다.
   - `tools\config.toml`, `tools\.env` 파일이 자동으로 생깁니다.
4. **Claude API 키** 준비: https://console.anthropic.com → API Keys → 키 생성(결제 수단 등록 필요)
   - `tools\.env` 를 메모장으로 열어 `ANTHROPIC_API_KEY=발급받은키` 로 저장
5. **모델 지정**: `tools\config.toml` 의 `model = ""` 에 Anthropic 문서(Models)에 나온 모델 ID를 그대로 입력
6. `tools\setup.bat` 을 다시 실행하거나 아래 점검 명령으로 "준비 완료" 확인

> `tools\.env`, `tools\config.toml` 은 GitHub에 올리지 마세요(.gitignore로 제외됨, 웹 업로드 시 직접 확인).
> 회사 PC라면 프로그램 설치·외부 API 사용 전에 사내 IT 규정을 확인하세요.

## 2. 수업마다 할 일

1. `private\inbox\` 안에 **수업마다 폴더 하나**를 만들고 파일을 넣습니다.
   ```
   private\inbox\2026-09-28 저 신경 쓰지 마세요\
       한국적 사고 버리기 - 1 저 신경 쓰지 마세요.m4a.mp4   ← 랭디 녹음 그대로
       chat.txt       ← 채팅 복사해서 붙여넣기 (이름: chat 또는 채팅)
       comment.txt    ← 코멘트 복사해서 붙여넣기 (이름: comment 또는 코멘트)
   ```
   - 날짜는 녹음 파일명(`..._YYMMDD_...`) 또는 폴더명 앞(`2026-09-28`)에서 읽습니다. 없으면 파일 수정 날짜를 씁니다.
   - 녹음·채팅·코멘트 중 일부만 있어도 됩니다.
2. `tools\process.bat` 더블클릭 → 끝나면 `private\out` 폴더가 열립니다.
   - 처음 실행 때 음성 인식 모델을 한 번 내려받습니다(인터넷 필요, 이후 재사용).
   - 이미 처리한 폴더는 건너뜁니다. 다시 만들려면 명령창에서 `tools\process.bat --force`
3. `private\out\lesson-les_....zip` 을 휴대폰으로 옮깁니다(OneDrive·카카오톡 나에게 보내기·USB 등).
4. 휴대폰 앱 → **가져오기 → 수업 패키지 선택**

## 3. 주간 요약

`tools\weekly.bat` 더블클릭 → 최근 7일 수업으로 `private\out\weekly-YYYYWww.zip` 생성 → 앱 가져오기에서 선택.
특정 주를 만들려면 `tools\weekly.bat --end 2026-10-04`.

## 4. 설정 (`tools\config.toml`)

| 항목 | 설명 |
|---|---|
| `[llm] provider` | `anthropic`(Claude, 기본) / `openai_compat`(OpenAI 등 호환 API) / `manual`(API 키 없이 복사·붙여넣기) |
| `[llm] model` | 사용할 모델 ID. AI를 바꿀 때는 provider·model·api_key_env만 바꾸면 됩니다 |
| `[stt] model` | `small.en` 권장. 느리면 `base.en`, 정확도가 아쉬우면 `medium.en` |
| `[privacy] mask_words` | AI로 보내기 전에 가릴 단어. 예) `["Jenny", "제니"]` |

AI 요청 문장은 `tools\prompts\*.md` 파일입니다. 결과가 마음에 안 들면 이 파일을 고쳐 개선할 수 있습니다.

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `Python not found` | Python 설치 시 "Add to PATH"를 체크했는지 확인, PC 재시작 |
| `API 키 ... 비어 있습니다` | `tools\.env` 에 `ANTHROPIC_API_KEY=` 뒤에 키가 있는지 확인 |
| `HTTP 401` | 키가 잘못됨 / `HTTP 404` 모델 ID 확인 / `HTTP 429` 사용량 한도 — 잠시 후 다시 |
| `AI 응답을 두 번 모두 사용할 수 없었습니다` | 다시 실행(`--force`). 반복되면 `max_tokens` 를 늘리거나 모델 변경 |
| 음성 인식이 너무 느림 | `[stt] model = "base.en"` |

## 6. 개발자용

- 테스트: Langdy 폴더에서 `python -m unittest discover -s tools/tests -v` (AI·음성 인식은 가짜로 대체)
- 새 AI 공급자 추가: `tools/processor/llm/` 에 `complete(system, user, step) -> str` 를 구현한 클래스를 만들고 `llm/__init__.py` 에 등록
- 결과 형식: `schema/lesson.schema.json`(v2), `schema/package.schema.json`, `schema/weekly.schema.json`
