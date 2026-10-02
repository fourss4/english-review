<!--
"AI로 교정 찾기" 요청 문장 템플릿 (ADR 0005). 변수: {{chat}}, {{comment}}
앱이 변수를 채워 복사한다. 이 파일을 고치면 앱 코드 수정 없이 요청 문장을 개선할 수 있다.
-->
You are helping a Korean learner turn notes from a 1:1 English lesson into study material.
Below are (1) the CHAT messages the tutor typed during the lesson and (2) the tutor's COMMENT after the lesson.
The tutor may NOT use any special symbols, labels, or consistent formatting. Read for meaning.

Extract the following. Use ONLY what is in the text. Do not invent corrections or expressions that are not there.

1. "corrections": every place where the learner's sentence was corrected.
   - "original": the learner's incorrect sentence, copied exactly. If the learner's original sentence is not in the text, skip that item.
   - "corrected": the tutor's corrected version.
   - "explanation": the tutor's reason, in English. If the tutor gave no reason, write a short one yourself and start it with "(AI) ".
   - "natural": a more natural alternative ONLY if the tutor gave one. Otherwise omit.
   - "naturalKo": Korean meaning of the corrected (or natural) sentence.
2. "keyExpressions": the main expression or pattern the lesson was about (usually 1-2).
   - "text", "pattern" (e.g. "mind + A", if any), "meaningKo", "examples" (example sentences or dialogue lines from the text; "speaker" = "A"/"B" for dialogues; "ko" = Korean translation)
3. "expressions": other words or phrases the tutor taught or explained.
   - "text", "partOfSpeech" (if stated), "definition" (English, if stated), "meaningKo", "examples" ({"en", "ko"})

Rules:
- Korean only in "meaningKo", "naturalKo", and "ko". Everything else in English.
- Do not include any person's name, contact info, or greetings.
- Fix obvious typos from text recognition (for example "v" written instead of "y") in the tutor's sentences.
- Output ONLY valid JSON in exactly this format. No markdown, no code fences, no extra text.

{
  "schemaVersion": 1,
  "kind": "lesson_structure",
  "keyExpressions": [
    { "text": "Take your time", "pattern": "take + A + time", "meaningKo": "천천히 하세요",
      "examples": [ { "speaker": "A", "en": "Sorry, I'm still choosing.", "ko": "미안, 아직 고르는 중이야." } ] }
  ],
  "expressions": [
    { "text": "rush through (something)", "partOfSpeech": "phrasal verb", "definition": "to do something too quickly",
      "meaningKo": "~을 서둘러 해치우다", "examples": [ { "en": "I always rush through lunch.", "ko": "나는 항상 점심을 급하게 먹는다." } ] }
  ],
  "corrections": [
    { "original": "My hobby is watching movie in the weekend.", "corrected": "My hobby is watching movies on the weekend.",
      "explanation": "Use the plural \"movies\" and \"on the weekend.\"", "natural": "I like to watch movies on weekends.",
      "naturalKo": "나는 주말에 영화 보는 것을 좋아한다." }
  ]
}

CHAT:
{{chat}}

COMMENT:
{{comment}}
