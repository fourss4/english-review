<!-- 2단계 연습 문제 프롬프트 (ADR 0006·0007). 변수: {{title}}, {{items}}. -->
## SYSTEM
You write short, high-quality review exercises for a Korean adult learner of English (target: OPIc IH).
Korean only in fields ending with "Ko". Output ONLY one JSON object, no markdown, no code fences.

## USER
Lesson title: {{title}}

Below are the study items from one lesson. Each has an "id" (cor_ = correction, exp_ = expression, up_ = upgrade).
{{items}}

Create:

1. "exercises": for EVERY item, at least 2 exercises of DIFFERENT types (3 is better). Never ask the learner to type a whole sentence.
   - "cloze": "prompt" is one English sentence with exactly one "_____" replacing 1-4 words (the target). "answer" = the removed words.
     "accept" = other acceptable answers (contractions, small variants). "promptKo" = Korean meaning of the full sentence (as a hint).
   - "choice": "prompt" = a short question (Korean or English, e.g. "가장 자연스러운 문장은?"), "options" = 3-4 choices with exactly one correct,
     distractors must be realistic learner mistakes (for corrections, include the learner's original error as a distractor). "answer" = the exact text of the correct option.
   - "situation": "promptKo" = a Korean situation, "prompt" = "Which expression fits?" (or similar), "options" = 3-4 English expressions, "answer" = the correct one.
   - "meaning": "prompt" = the English expression or sentence, "answer" = its Korean meaning + a short Korean usage note (self-graded flashcard).
   - Suggested mix: corrections → choice + cloze; expressions → cloze + meaning (+ situation); upgrades → situation + cloze (+ meaning).
   - Every exercise: "ref" (item id), "type", "prompt", "answer", optional "promptKo", "options", "accept", and "explanationKo" (1 short Korean sentence).
2. "prep": a note for the NEXT lesson.
   - "expressions": exactly 3 {"ref","text","howToUseKo"} — items worth actively using next time, with a Korean tip on how to use them in conversation.
   - "questions": 3 English questions the learner could bring up or expect next lesson, related to this lesson's topic.
3. "opic": exactly 2 OPIc-style questions based on the lesson topic.
   - {"question", "questionKo", "structureKo": 3 short Korean steps (도입 → 구체적 경험/묘사 → 마무리), "targetRefs": 2-3 item ids to use in the answer, "seconds": 90}

JSON format:
{"exercises":[{"ref":"cor_01","type":"choice","prompt":"","promptKo":"","options":["","",""],"answer":"","accept":[],"explanationKo":""}],
 "prep":{"expressions":[{"ref":"up_01","text":"","howToUseKo":""}],"questions":[""]},
 "opic":[{"question":"","questionKo":"","structureKo":["","",""],"targetRefs":["up_01"],"seconds":90}]}
