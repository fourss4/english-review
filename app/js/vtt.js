// 시간 표기·WebVTT 변환 (구간 북마크 / 스크립트). DOM 비의존.

/** 83.5 → "01:23" (1시간 이상이면 "1:01:23") */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

/** 83.5 → "00:01:23.500" */
export function toVttTime(sec) {
  const ms = Math.max(0, Math.round((sec || 0) * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

/** "00:01:23.500" 또는 "01:23.500" → 83.5 */
export function fromVttTime(t) {
  const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return NaN;
  const [, h = '0', mi, s, ms = '0'] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

// 큐 텍스트: "-->"·빈 줄은 VTT 구조를 깨므로 치환, & < > 는 WebVTT 규칙대로 이스케이프(태그로 해석 방지)
const cueText = (s) => (String(s ?? '').replace(/-->/g, '→').replace(/\r?\n\s*\r?\n/g, '\n').trim() || '(구간)')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeCue = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** 북마크 배열 → WebVTT 문자열 (시작 시각 순) */
export function bookmarksToVtt(bookmarks) {
  const cues = [...bookmarks].sort((a, b) => a.startSec - b.startSec)
    .map((b) => `NOTE id=${b.id}\n\n${toVttTime(b.startSec)} --> ${toVttTime(b.endSec)}\n${cueText(b.label)}`);
  return ['WEBVTT', ...cues].join('\n\n') + '\n';
}

/** WebVTT → [{id?, startSec, endSec, text}] (NOTE id=… 가 바로 앞에 있으면 id로 연결) */
export function parseVtt(text) {
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  if (!/^WEBVTT/.test(blocks[0] || '')) throw new Error('WEBVTT 헤더가 없습니다.');
  const out = [];
  let pendingId = null;
  for (const b of blocks.slice(1)) {
    const lines = b.split('\n').filter((l) => l.length);
    if (!lines.length) continue;
    const note = lines[0].match(/^NOTE id=(\S+)/);
    if (note) { pendingId = note[1]; continue; }
    if (lines[0].startsWith('NOTE')) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const startSec = fromVttTime(a), endSec = fromVttTime(z);
    if (Number.isNaN(startSec) || Number.isNaN(endSec)) continue;
    out.push({ ...(pendingId ? { id: pendingId } : {}), startSec, endSec, text: unescapeCue(lines.slice(ti + 1).join('\n')) });
    pendingId = null;
  }
  return out;
}

/**
 * A-B 반복 판단: 현재 위치가 B를 지났으면 A로 되돌릴 위치를 반환, 아니면 null.
 * B가 A보다 앞이면 무시(사용자가 순서를 바꿔 찍은 경우 호출 측에서 정렬).
 */
export function loopTarget(currentSec, loop) {
  if (!loop || !(loop.endSec > loop.startSec)) return null;
  return currentSec >= loop.endSec || currentSec < loop.startSec - 0.5 ? loop.startSec : null;
}
