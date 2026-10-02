// 랭디 원본 → 표준 Lesson(schemaVersion 1) 변환기
// 형식 근거: docs/sample-analysis.md
// 원칙: 원본에 없는 값은 추정하지 않는다(category, 한국어 뜻 등은 비워 둠).

import { normalizeText, similarity, containsFuzzy, findSuspiciousWords } from '../text.js';

export const PARSER_VERSION = 'langdy-v1';
const MATCH = 0.8;

/**
 * 녹음 파일명 해석.
 * 원본: "<과정명> - <회차> <수업 제목>.m4a.mp4"
 * 사용자가 붙인 접두어 "<임의>_<YYMMDD>_" 가 있으면 날짜로 사용.
 */
export function parseFileName(name) {
  const res = { originalFileName: name };
  let base = String(name || '').replace(/(\.m4a)?\.(mp4|m4a)$/i, '');
  const pre = base.match(/^[^_]*_(\d{6})_(.*)$/);
  if (pre) {
    const [, d, rest] = pre;
    res.date = `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`;
    base = rest;
  }
  const m = base.match(/^(.+?)\s+-\s+(\d+)\s+(.+)$/);
  if (m) {
    res.course = m[1].trim();
    res.lessonNo = Number(m[2]);
    res.title = m[3].trim();
  } else if (base.trim()) {
    res.title = base.trim();
  }
  return res;
}

const MARK = { '❌': 'wrong', '✅': 'right', '💡': 'tip' };
const MARK_RE = /^(❌|✅|💡)\s*[:：]?\s*(.*)$/u;
const DIALOG_RE = /^([A-Z])\.\s+(.+)$/;
const PATTERN_RE = /^[A-Za-z' ]+\s\+\s[A-Za-z' +]+$/;

/**
 * 채팅(강사 교정 노트) 해석.
 * @returns {{keyExpression:string|null, pattern:string|null, corrections:object[], dialogues:object[], ignored:string[], warnings:string[]}}
 */
export function parseChat(raw) {
  const lines = normalizeText(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { keyExpression: null, pattern: null, corrections: [], dialogues: [], ignored: [], warnings: [] };
  if (!lines.length) return out;

  // 핵심 표현 = 마커 없는 마지막 평문 줄(수업 끝에 반복됨)
  const isPlain = (l) => !MARK_RE.test(l) && !DIALOG_RE.test(l) && !PATTERN_RE.test(l);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isPlain(lines[i])) { out.keyExpression = lines[i]; break; }
  }

  let cur = null;
  let dialog = null;
  const flushDialog = () => { if (dialog && dialog.length) out.dialogues.push(dialog); dialog = null; };

  for (const line of lines) {
    const mk = line.match(MARK_RE);
    if (mk) {
      flushDialog();
      const kind = MARK[mk[1]];
      const text = mk[2].trim();
      if (kind === 'wrong') {
        cur = { original: text };
        out.corrections.push(cur);
      } else if (!cur) {
        out.warnings.push(`교정 블록 밖의 ${kind === 'tip' ? '💡' : '✅'} 줄을 건너뜀`);
      } else if (kind === 'right') {
        if (cur.corrected === undefined) cur.corrected = text;
        else if (cur.natural === undefined) cur.natural = text;
        else out.warnings.push('한 교정 블록에 ✅ 줄이 3개 이상');
      } else if (kind === 'tip') {
        cur.explanation = cur.explanation ? `${cur.explanation} ${text}` : text;
      }
      continue;
    }
    const dm = line.match(DIALOG_RE);
    if (dm) {
      cur = null;
      if (!dialog) dialog = [];
      dialog.push({ speaker: dm[1], en: dm[2].trim() });
      continue;
    }
    flushDialog();
    cur = null;
    if (PATTERN_RE.test(line)) { if (!out.pattern) out.pattern = line; continue; }
    if (line === out.keyExpression) continue;
    out.ignored.push(line);
  }
  flushDialog();

  out.corrections.forEach((c, i) => { if (c.corrected === undefined) out.warnings.push(`교정 ${i + 1}: ✅ 줄 없음`); });
  return out;
}

/**
 * 코멘트(문단 서술) 해석. 교정 문장은 채팅 쪽을 우선(OCR 오류 회피).
 * @param {string} raw
 * @param {object[]} chatCorrections parseChat().corrections
 */
export function parseComment(raw, chatCorrections = []) {
  const paras = normalizeText(raw).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = { summary: null, expressions: [], explanations: [], unmatched: [], suspicious: [] };
  if (!paras.length) return out;
  out.suspicious = findSuspiciousWords(raw);
  out.summary = paras[0];

  const findCorr = (text) => chatCorrections.findIndex((c) => c.original && containsFuzzy(text, c.original, MATCH));

  for (const p of paras.slice(1)) {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
    const head = lines[0].match(/^(.+?)\s+-\s+([A-Za-z ]+?)\s*\/\s*(.+)$/);
    if (head) {
      // 표현 카드: "표현 - 품사 / 정의. [틀린 예문]" + 다음 줄들: 개선 예문
      const [, text, pos, rest] = head;
      const ci = findCorr(rest);
      let definition = rest;
      if (ci >= 0) {
        // 정의 = 틀린 예문이 시작되기 전까지(첫 마침표 기준)
        const dot = rest.indexOf('. ');
        definition = dot > 0 ? rest.slice(0, dot) : rest;
      }
      definition = definition.replace(/[.,\s]+$/, '');
      const examples = [];
      for (const l of lines.slice(1)) {
        const c = ci >= 0 ? chatCorrections[ci] : null;
        if (c && c.natural && similarity(l, c.natural) >= MATCH) examples.push({ en: c.natural });
        else if (c && c.corrected && similarity(l, c.corrected) >= MATCH) examples.push({ en: c.corrected });
        else examples.push({ en: l, ocr: true });
      }
      out.expressions.push({ text: text.trim(), partOfSpeech: pos.trim(), definition, examples, correctionIndex: ci });
      continue;
    }
    // 교정 해설: 문단 안에 채팅 교정의 틀린 문장이 포함됨
    const ci = findCorr(p);
    if (ci >= 0) {
      const c = chatCorrections[ci];
      const kept = lines.filter((l) => !containsFuzzy(l, c.original, MATCH));
      out.explanations.push({ correctionIndex: ci, text: (kept.length ? kept : lines).join(' ') });
    } else {
      out.unmatched.push(p);
    }
  }
  return out;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * 전체 변환. 결과는 미리보기·수정 후 저장한다.
 * @param {{fileName?:string, chat?:string, comment?:string, seq?:number, now?:Date, fallbackDate?:string}} input
 */
export function buildLesson({ fileName = '', chat = '', comment = '', seq = 1, now = new Date(), fallbackDate } = {}) {
  const fn = parseFileName(fileName);
  const c = parseChat(chat);
  const m = parseComment(comment, c.corrections);

  const dateStr = fn.date || fallbackDate || now.toISOString().slice(0, 10);
  const id = `les_${dateStr.replace(/-/g, '')}_${pad2(seq)}`;

  const expressions = [];
  if (c.keyExpression) {
    const key = { id: 'exp_01', text: c.keyExpression, isKey: true };
    if (c.pattern) key.pattern = c.pattern;
    const ex = c.dialogues.flat();
    if (ex.length) key.examples = ex;
    expressions.push(key);
  }
  for (const e of m.expressions) {
    const item = { id: `exp_${pad2(expressions.length + 1)}`, text: e.text, partOfSpeech: e.partOfSpeech, definition: e.definition };
    const ex = e.examples.map(({ en }) => ({ en }));
    if (ex.length) item.examples = ex;
    expressions.push(item);
  }

  const corrections = c.corrections.map((x, i) => {
    const o = { id: `cor_${pad2(i + 1)}`, original: x.original, corrected: x.corrected ?? '' };
    if (x.explanation) o.explanation = x.explanation;
    if (x.natural) o.natural = x.natural;
    return o;
  });
  for (const ex of m.explanations) corrections[ex.correctionIndex].explanationLong = ex.text;

  const lesson = {
    schemaVersion: 1,
    id,
    date: `${dateStr}T00:00:00+09:00`,
    ...(fn.course ? { course: fn.course } : {}),
    ...(fn.lessonNo !== undefined ? { lessonNo: fn.lessonNo } : {}),
    ...(fn.title ? { title: fn.title } : {}),
    ...(fileName ? { audio: { file: 'audio.mp4', mimeType: 'audio/mp4', originalFileName: fn.originalFileName } } : {}),
    ...(m.summary ? { feedback: { summary: m.summary } } : {}),
    expressions,
    corrections,
    chat: [],
    source: { app: 'langdy', importedAt: now.toISOString(), parserVersion: PARSER_VERSION, raw: { comment, chat } },
  };

  const report = {
    warnings: c.warnings,
    ignoredChatLines: c.ignored,
    unmatchedCommentParagraphs: m.unmatched,
    suspiciousWords: m.suspicious,
    ocrExamples: m.expressions.flatMap((e) => e.examples.filter((x) => x.ocr).map((x) => x.en)),
  };
  return { lesson, report };
}

/** 저장 전 경량 검증(런타임). 전체 JSON Schema 검증은 테스트에서 수행 */
export function validateLesson(l) {
  const errs = [];
  if (l?.schemaVersion !== 1) errs.push('schemaVersion');
  if (!/^les_[A-Za-z0-9_]+$/.test(l?.id || '')) errs.push('id');
  if (Number.isNaN(Date.parse(l?.date))) errs.push('date');
  for (const k of ['expressions', 'corrections', 'chat']) if (!Array.isArray(l?.[k])) errs.push(k);
  (l?.expressions || []).forEach((e, i) => { if (!e.text) errs.push(`expressions[${i}].text`); });
  (l?.corrections || []).forEach((c, i) => { if (!c.original || !c.corrected) errs.push(`corrections[${i}]`); });
  return errs;
}
