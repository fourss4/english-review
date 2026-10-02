# 데이터 명세 (data-spec) v0.1 — schemaVersion 1

> 이 문서와 `/schema/*.json`이 앱·도구 간 계약입니다. 변경 시 이 문서를 먼저 수정하고 `schemaVersion`을 올린 뒤 마이그레이션 함수를 추가합니다.
> 상태: 초안. 원본 샘플 분석 후 필드 확정.

## 공통 규칙
- 인코딩: UTF-8, 줄바꿈 LF
- 시각: ISO 8601 (`2026-10-02T21:00:00+09:00`)
- 오디오 내 위치: 초 단위 실수 (`startSec: 83.5`)
- ID: 사람이 읽을 수 있는 접두어 + 고유값 (`les_20261002_01`, `exp_…`, `cor_…`, `crd_…`)
- 실명 금지: 사람은 별칭으로만 기록 (`tutorAlias: "T01"`, 화자 `me`/`tutor`/`system`)
- 알 수 없는 필드는 삭제하지 않고 보존 (상위 버전 데이터를 하위 앱이 열어도 유실 방지)

## 1. Lesson (`lessons/<id>/lesson.json`) — `schema/lesson.schema.json`
```json
{
  "schemaVersion": 1,
  "id": "les_20261002_01",
  "date": "2026-10-02T21:00:00+09:00",
  "title": "Talking about weekend plans",
  "tutorAlias": "T01",
  "durationSec": 1500,
  "audio": { "file": "audio.m4a", "mimeType": "audio/mp4", "durationSec": 1500 },
  "transcript": { "file": "transcript.vtt", "generator": "whisper.cpp" },
  "expressions": [
    { "id": "exp_01", "text": "call it a day", "meaning": "그만 마무리하다",
      "example": "Let's call it a day.", "note": "", "tags": ["idiom"] }
  ],
  "corrections": [
    { "id": "cor_01", "original": "I very like it.", "corrected": "I really like it.",
      "explanation": "very는 동사를 직접 수식하지 않음", "category": "grammar" }
  ],
  "chat": [
    { "id": "msg_001", "at": "2026-10-02T21:03:10+09:00", "offsetSec": 190,
      "speaker": "tutor", "text": "Try saying it again." }
  ],
  "notes": "자유 메모(Markdown)",
  "source": { "app": "langdy", "importedAt": "2026-10-03T08:00:00+09:00", "parserVersion": "langdy-v1",
              "raw": { "comment": "(붙여넣은 코멘트 원문)", "chat": "(붙여넣은 채팅 원문)" } }
}
```
- `audio`, `transcript`, `chat[].offsetSec`은 선택값입니다. 원본에 없으면 생략하고 추정값을 넣지 않습니다.
- `audio.mimeType`: 랭디 녹음은 mp4로 제공됨. 오디오 전용이면 `audio/mp4`, 영상 포함이면 `video/mp4`(샘플로 확인 예정)
- `source.raw`: 붙여넣은 원문을 그대로 보존해 파서가 개선되면 다시 변환할 수 있게 함
- **랭디 원본 분석 반영(2026-10-02, [`sample-analysis.md`](./sample-analysis.md))**
  - Lesson: `course`(과정명), `lessonNo`(회차), `feedback.summary`(코멘트 총평), `audio.originalFileName`
  - expressions[]: `isKey`(수업 핵심 표현), `pattern`(예: `mind + A`), `partOfSpeech`, `definition`(영문 정의), `examples[]`(`{speaker?, en, ko?}`)
  - corrections[]: `natural`(💡 다음 ✅ — 더 자연스러운 표현), `explanationLong`(코멘트의 긴 해설)
  - 랭디 채팅은 화자·시각 없이 강사의 교정 노트 형식이라 `chat[]`은 비워 두고 원문은 `source.raw.chat`에 보존
  - 기대 변환 예시: `/samples/normalized/les_20260101_01/lesson.json`
- `corrections[].category`: `grammar | vocabulary | pronunciation | expression | other`

## 2. Card (`review/cards.json`) — `schema/card.schema.json`
```json
{
  "schemaVersion": 1,
  "cards": [
    { "id": "crd_exp_01_en2ko", "source": { "type": "expression", "lessonId": "les_20261002_01", "itemId": "exp_01" },
      "direction": "en2ko", "front": "call it a day", "back": "그만 마무리하다",
      "srs": { "algorithm": "sm2", "ease": 2.5, "intervalDays": 0, "reps": 0, "due": "2026-10-03" },
      "suspended": false,
      "log": [ { "at": "2026-10-03T08:10:00+09:00", "grade": 4 } ] }
  ]
}
```
- `source.type`: `expression | correction | generated | manual`
- `direction` (구현: `app/js/cards.js`)
  | 값 | 앞면 → 뒷면 | 생성 조건 |
  |---|---|---|
  | `en2ko` / `ko2en` | 표현 ↔ 한국어 뜻 | 표현에 `meaning`(한국어)이 있을 때 |
  | `en2def` | 표현 → 영문 정의·패턴·예문 | 한국어 뜻이 없을 때 대체 |
  | `cloze` | 예문 빈칸 → 표현 입력 | 예문에 표현이 들어 있을 때(괄호 부분 생략·어형 변화 허용) |
  | `fix` | 틀린 문장 → 직접 고쳐 쓰기 | 교정 항목마다. `answer`=교정, `altAnswer`=더 자연스러운 표현, 둘 중 더 가까운 쪽으로 채점 |
- 카드 ID: `crd_<수업날짜_순번>_<항목ID>_<direction>` — 같은 항목은 항상 같은 ID라서 수업을 고쳐도 학습 이력 유지
- 수업 수정 시 카드 내용은 갱신, `srs`·`log`는 유지. 수업에서 빠진 항목의 카드는 `suspended: true, suspendedReason: "removed"`
- 간격반복: SM-2. 버튼 다시=1·어려움=3·보통=4·쉬움=5. 오답(3 미만)은 다음 날 + 같은 세션 끝에 한 번 더. 하루 새 카드 기본 20장(설정 가능)
- `grade`: SM-2 기준 0~5

### Anki 호환 TSV (`review/cards-anki.tsv`)
`#separator:tab`, `#html:false` 헤더 후 `front<TAB>back<TAB>tags` 형식. 복습 이력은 TSV에 포함되지 않습니다(cards.json이 원본).

## 3. Bookmark / Transcript (WebVTT)
- 구간 북마크: IndexedDB `bookmarks` 스토어 `{id, lessonId, startSec, endSec, label, createdAt}` → 내보내기 시 `lessons/<id>/bookmarks.vtt`
- 구현: `app/js/vtt.js` (`NOTE id=…` 로 ID 보존, 큐 텍스트의 `& < >` 는 WebVTT 규칙대로 이스케이프)
- 쉐도잉 녹음(내 목소리)은 저장하지 않음(화면을 떠나면 폐기)
```
WEBVTT

NOTE id=bm_01

00:01:23.500 --> 00:01:31.000
weekend plans 표현 연습
```

## 4. Generated (`generated/<id>.json`) — `schema/generated.schema.json`
```json
{
  "schemaVersion": 1,
  "id": "gen_20261003_quiz_01",
  "lessonId": "les_20261002_01",
  "kind": "quiz",
  "generator": { "tool": "tools/generate", "provider": "mock", "model": "mock-1", "createdAt": "2026-10-03T09:00:00+09:00" },
  "items": [
    { "id": "q_01", "type": "multiple_choice", "prompt": "Choose the natural sentence.",
      "options": ["I very like it.", "I really like it."], "answerIndex": 1,
      "explanation": "", "refs": ["cor_01"] }
  ]
}
```
- `kind`: `expression_upgrade`(기본, ADR 0003) `| quiz | example_sentences | dialogue`(예비)
- `items[].type`: `upgrade`(기본) `| multiple_choice | fill_blank | translate | free_text | fix_sentence`

### 4-1. 표현 업그레이드 항목 (`type: upgrade`)
```json
{ "id": "up_01", "type": "upgrade", "category": "idiom",
  "original": "I was very tired so I stopped working.", "originalOffsetSec": 312.4,
  "suggestion": "I was so beat that I called it a day.", "meaningKo": "너무 지쳐서 그날 일을 마무리했다",
  "explanation": "very tired → beat(구어), stopped working → call it a day(관용구)로 더 자연스러움",
  "register": "casual",
  "examples": [ { "en": "Let's call it a day.", "ko": "오늘은 여기까지 하자." },
                { "en": "I was totally beat after the hike.", "ko": "등산 후 완전히 녹초가 됐다." } ],
  "situationKo": "피곤해서 하던 일을 그만 마무리하자고 말할 때",
  "opicQuestion": "Tell me about a time you felt exhausted after a long day." }
```
- 업그레이드 항목은 가져올 때 카드 2종(상황→표현, 바꿔 말하기)으로 자동 변환된다(`source.type: generated`, `source.itemId: up_01`).
- 연습 기록: 카드 `log`에 기록. OPIc 챌린지 답변 녹음은 `practice/<cardId>/<at>.webm`(백업 포함 여부 선택).
- 생성 경로: 앱의 "프롬프트 복사 → AI 결과 붙여넣기"(ADR 0002) 또는 선택형 CLI. `generator.provider`에는 사용한 서비스명을 사용자가 선택해 기록
- 앱은 Generated를 읽기만 하고, 사용자가 원하면 카드로 변환합니다(`source.type: generated`).

## 5. 백업 ZIP과 Manifest — `schema/manifest.schema.json`
```
backup-YYYYMMDD-HHmm.zip
├─ manifest.json
├─ README.md                 # 이 백업의 구조 설명(사람용)
├─ lessons/<id>/lesson.json
├─ lessons/<id>/audio.m4a
├─ lessons/<id>/transcript.vtt   (선택)
├─ lessons/<id>/bookmarks.vtt    (선택)
├─ review/cards.json
├─ review/cards-anki.tsv
└─ generated/<id>.json
```
```json
{
  "format": "english-review-backup",
  "schemaVersion": 1,
  "createdAt": "2026-10-03T09:30:00+09:00",
  "appVersion": "0.1.0",
  "counts": { "lessons": 12, "cards": 240, "generated": 3 },
  "files": [ { "path": "lessons/les_20261002_01/lesson.json", "bytes": 4210, "sha256": "…" } ]
}
```
- 구현: `app/js/backup.js`, `app/js/zip.js`(ADR 0004), `app/js/migrations.js`
- manifest 추가 필드: `audioIncluded`(녹음 포함 여부), `counts.bookmarks`, `counts.audio`. 파일명 `english-review-backup-YYYYMMDD-HHmm.zip`
- 복원 시: 경로 검증(`..`, 절대경로, 역슬래시 거부, 허용 경로 목록) → 크기 상한(항목 300MB, JSON 5MB, 전체 4GB, 5,000개) → manifest 형식·버전 확인(더 새 버전이면 거부) → SHA-256 검증 → 수업 검증 → 마이그레이션 → 저장
- 알 수 없는 파일·manifest에 없는 파일은 저장하지 않고 경고만 표시
- 백업에 녹음이 없으면(녹음 제외 백업) 기기에 있던 녹음은 유지
- 같은 `id`가 이미 있으면 사용자에게 덮어쓰기/건너뛰기 선택

## 6. IndexedDB 매핑
| Store | Key | 내용 |
|---|---|---|
| lessons | id | Lesson JSON(오디오 제외) |
| audio | lessonId | Blob + mimeType |
| cards | id | Card |
| bookmarks | id (index: lessonId) | lessonId, startSec, endSec, label, createdAt |
| generated | id | Generated |
| meta | key | schemaVersion, lastBackupAt 등 |

## 7. 버전 관리
- `schemaVersion` 정수. 변경 시 `migrations/v1-to-v2.js` 형태로 추가하고, 구 버전 샘플 복원 테스트를 유지합니다.
