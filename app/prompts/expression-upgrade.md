<!--
템플릿 변수: {{count}}, {{lessonId}}, {{createdAt}}, {{transcript}}, {{existingItems}}
앱이 변수를 채워 클립보드에 복사한다. 이 파일을 고치면 앱 코드 수정 없이 프롬프트를 개선할 수 있다.
-->
You are an English speaking coach for a Korean learner preparing for OPIc at the IH (Intermediate High) level.

Below is a transcript of a 1:1 English conversation lesson. It contains both the learner and the tutor, and speakers are NOT labeled.
Infer which lines are the learner's from context (shorter, less natural, Korean-influenced sentences are usually the learner's).

Task: pick exactly {{count}} items from the LEARNER's speech that would most improve their OPIc IH performance. Mix these categories when possible:
- "slang": common casual expressions natives use that would sound natural in OPIc (avoid vulgar or offensive slang)
- "idiom": idioms or phrasal verbs that fit what the learner was trying to say
- "better_expression": a more natural / more precise rewrite of a sentence or word the learner actually said

Rules:
- "original" must quote the learner's words from the transcript exactly. If you are unsure it was the learner, skip it.
- "originalOffsetSec": the start time of that line in seconds if the transcript has timestamps, otherwise omit.
- Write "meaningKo", "explanation", "situationKo", and the "ko" of examples in Korean. Everything else in English.
- "explanation": why it is better, nuance, and any caution (too casual, regional, etc.). 2-3 sentences.
- "examples": 2 or 3 natural sentences, at least one in an OPIc-style personal context (daily life, hobbies, travel, past experience).
- "opicQuestion": one realistic OPIc-style question where the learner could use this expression.
- If the transcript is empty, return "items": [] and do only Task 2.

Task 2: for every entry in [Existing items], fill Korean in "koFills":
- expressions (ref "exp_.."): "meaningKo" (natural Korean meaning), "situationKo" (when to use it, one Korean sentence), "examplesKo" (Korean translations of its examples, same order)
- corrections (ref "cor_.."): "naturalKo" (Korean meaning of the corrected/natural sentence)
- Keep "ref" exactly as given. Do not invent refs.

- Output ONLY valid JSON matching the format below. No markdown, no code fences, no extra text.

Format:
{
  "schemaVersion": 1,
  "id": "gen_{{lessonId}}_upgrade",
  "lessonId": "{{lessonId}}",
  "kind": "expression_upgrade",
  "generator": { "tool": "prompt-relay", "provider": "FILL_SERVICE_NAME", "createdAt": "{{createdAt}}" },
  "items": [
    {
      "id": "up_01",
      "type": "upgrade",
      "category": "idiom",
      "original": "I was very tired so I stopped working.",
      "originalOffsetSec": 312.4,
      "suggestion": "I was so beat that I called it a day.",
      "meaningKo": "너무 지쳐서 그날 일을 마무리했다",
      "explanation": "...",
      "register": "casual",
      "examples": [ { "en": "...", "ko": "..." }, { "en": "...", "ko": "..." } ],
      "situationKo": "피곤해서 하던 일을 그만 마무리하자고 말할 때",
      "opicQuestion": "Tell me about a time you felt exhausted after a long day. What did you do?"
    }
  ],
  "koFills": [
    { "ref": "exp_01", "meaningKo": "저 신경 쓰지 마세요", "situationKo": "상대가 나 때문에 불편해하지 않도록 말할 때", "examplesKo": ["...", "..."] },
    { "ref": "cor_01", "naturalKo": "..." }
  ]
}

Existing items:
{{existingItems}}

Transcript:
{{transcript}}
