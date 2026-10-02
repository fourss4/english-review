// 텍스트 유틸리티 (DOM 비의존, Node 테스트 가능)

/** 둥근 따옴표·특수 공백을 표준 문자로 정규화 */
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 비교용 키: 소문자 + 영문/숫자만 */
function compareKey(s) {
  return normalizeText(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

/** 문자 bigram Dice 유사도(0~1). OCR 오탈자가 몇 글자 섞여도 높은 값 */
export function similarity(a, b) {
  const x = compareKey(a), y = compareKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

/** 긴 텍스트 안에 문장이 (오탈자 허용) 포함되어 있는지: 슬라이딩 윈도우 최대 유사도 */
export function containsFuzzy(haystack, needle, threshold = 0.8) {
  const h = compareKey(haystack), n = compareKey(needle);
  if (!n || h.length < n.length * 0.8) return similarity(haystack, needle) >= threshold;
  if (h.includes(n)) return true;
  const step = Math.max(1, Math.floor(n.length / 10));
  let best = 0;
  for (let i = 0; i + n.length * 0.8 <= h.length; i += step) {
    const s = similarity(h.slice(i, i + n.length), n);
    if (s > best) best = s;
    if (best >= threshold) return true;
  }
  return false;
}

/**
 * 단어 단위 비교(LCS). 문장 고치기 채점 표시용.
 * @returns {{ops: {type:'same'|'add'|'del', text:string}[], score:number}} score = 일치 단어 비율(0~1)
 */
export function wordDiff(answer, typed) {
  const tok = (s) => normalizeText(s).split(/\s+/).filter(Boolean);
  const key = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const a = tok(answer), b = tok(typed);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) { ops.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: 'del', text: a[i++] });
    else ops.push({ type: 'add', text: b[j++] });
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i++] });
  while (j < b.length) ops.push({ type: 'add', text: b[j++] });
  const score = a.length || b.length ? dp[0][0] / Math.max(a.length, b.length) : 1;
  return { ops, score };
}

const OCR_WHITELIST = new Set(['rev', 'dev', 'lev', 'gov', 'tv', 'iv', 'mv', 'qatar', 'iraq']);

/**
 * OCR 오류 의심 단어 목록. 자동 수정은 하지 않고 미리보기에서 표시만 한다.
 * 규칙: 비ASCII 라틴 문자 포함 / 'v'로 끝나거나 v 뒤 자음(y 오인) / 'q' 뒤에 'u'가 없음(g 오인)
 */
export function findSuspiciousWords(text) {
  const out = new Set();
  for (const w of normalizeText(text).match(/[A-Za-zÀ-ɏ]+/g) || []) {
    const lw = w.toLowerCase();
    if (OCR_WHITELIST.has(lw)) continue;
    if (/[À-ɏ]/.test(w) || /v$/.test(lw) || /v[^aeiouyv]/.test(lw) || /q(?!u)/.test(lw)) out.add(w);
  }
  return [...out];
}
