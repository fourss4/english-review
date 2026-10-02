// 수업 데이터 → 복습 카드 생성, Anki TSV 내보내기. DOM 비의존.
// 카드 종류(direction)
//   en2ko  : 영어 표현 → 한국어 뜻        (한국어 뜻이 있을 때)
//   ko2en  : 한국어 뜻 → 영어 표현        (한국어 뜻이 있을 때)
//   en2def : 영어 표현 → 영문 정의·예문   (한국어 뜻이 없을 때 대체)
//   cloze  : 예문 빈칸 → 표현 입력
//   fix    : 틀린 문장 → 직접 고쳐 쓰기

import { newSrs } from './srs.js';
import { normalizeText } from './text.js';

const exampleText = (e) => (e.examples || []).map((x) => (x.speaker ? `${x.speaker}. ${x.en}` : x.en)).join('\n');

/** 표현이 들어 있는 첫 예문을 찾아 빈칸 처리. 괄호 부분("(your)")은 생략 가능으로 취급 */
export function makeCloze(expression, examples = []) {
  const core = normalizeText(expression).replace(/\([^)]*\)/g, ' ').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (core.split(' ').length < 1 || core.length < 3) return null;
  const words = core.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // 단어 사이에 0~2개 단어 허용(예: raise (your) voice → raise their voices)
  const re = new RegExp(`\\b${words.join("(?:\\s+[\\w']+){0,2}?\\s+")}\\w*`, 'i');
  for (const ex of examples) {
    const m = normalizeText(ex.en).match(re);
    if (m) {
      const sentence = normalizeText(ex.en);
      return { front: sentence.slice(0, m.index) + '_____' + sentence.slice(m.index + m[0].length), answer: m[0], sentence };
    }
  }
  return null;
}

/** 한 수업에서 만들어져야 할 카드 내용(학습 상태 제외) */
export function cardsForLesson(lesson) {
  const out = [];
  const base = (itemId, type, direction) => ({
    id: `crd_${lesson.id.replace(/^les_/, '')}_${itemId}_${direction}`,
    source: { type, lessonId: lesson.id, itemId },
    direction,
  });

  for (const e of lesson.expressions || []) {
    const extra = [e.pattern && `패턴: ${e.pattern}`, e.definition && `${e.partOfSpeech ? `(${e.partOfSpeech}) ` : ''}${e.definition}`, exampleText(e)]
      .filter(Boolean).join('\n');
    if (e.meaning) {
      out.push({ ...base(e.id, 'expression', 'en2ko'), front: e.text, back: [e.meaning, extra].filter(Boolean).join('\n') });
      out.push({ ...base(e.id, 'expression', 'ko2en'), front: e.meaning, back: [e.text, extra].filter(Boolean).join('\n') });
    } else if (extra) {
      out.push({ ...base(e.id, 'expression', 'en2def'), front: e.text, back: extra });
    }
    const cz = makeCloze(e.text, e.examples);
    if (cz) out.push({ ...base(e.id, 'expression', 'cloze'), front: cz.front, back: cz.sentence, answer: cz.answer });
  }

  for (const c of lesson.corrections || []) {
    if (!c.original || !c.corrected) continue;
    const back = [c.corrected, c.natural && `더 자연스럽게: ${c.natural}`, c.explanation && `이유: ${c.explanation}`].filter(Boolean).join('\n');
    out.push({ ...base(c.id, 'correction', 'fix'), front: c.original, back, answer: c.corrected, ...(c.natural ? { altAnswer: c.natural } : {}) });
  }
  return out;
}

/**
 * 기존 카드와 병합: 내용(front/back/answer)은 최신 수업 기준으로 갱신하고 학습 상태(srs/log)는 유지.
 * 수업에서 사라진 항목의 카드는 suspended 처리(이력 보존).
 * @returns {{upserts: object[], suspends: object[]}}
 */
export function syncLessonCards(lesson, existing, today) {
  const want = cardsForLesson(lesson);
  const byId = new Map(existing.map((c) => [c.id, c]));
  const upserts = [];
  for (const w of want) {
    const old = byId.get(w.id);
    if (!old) { upserts.push({ ...w, srs: newSrs(today), suspended: false, log: [] }); continue; }
    const merged = { ...old, ...w, srs: old.srs, log: old.log, suspended: old.suspendedReason === 'removed' ? false : old.suspended };
    delete merged.suspendedReason;
    if (!('altAnswer' in w)) delete merged.altAnswer;
    if (!('answer' in w)) delete merged.answer;
    if (JSON.stringify(merged) !== JSON.stringify(old)) upserts.push(merged);
  }
  const wantIds = new Set(want.map((w) => w.id));
  const suspends = existing.filter((c) => !wantIds.has(c.id) && !c.suspended).map((c) => ({ ...c, suspended: true, suspendedReason: 'removed' }));
  return { upserts, suspends };
}

const tsvCell = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' / ').trim();

/** Anki 호환 TSV (front, back, tags). 학습 이력은 포함하지 않음 */
export function toAnkiTsv(cards) {
  const rows = cards.map((c) => [tsvCell(c.front), tsvCell(c.back), [c.source.lessonId, c.direction].join(' ')].join('\t'));
  return ['#separator:tab', '#html:false', '#tags column:3', ...rows].join('\n') + '\n';
}
