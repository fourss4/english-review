// 수업 상세의 녹음 플레이어: 속도, ±5초, 원하는 위치 재생(스크립트), 표현 구간 재생·정지(업그레이드·교정).
const SPEEDS = [0.75, 1, 1.25];
const $ = (id) => document.getElementById(id);

let audio, el, timeListener = null, clip = null, clipListener = null;

/**
 * 표현이 나온 구간 계산(DOM 비의존): offset이 들어 있는 스크립트 줄 기준, 짧으면 다음 줄까지, 최대 20초.
 * 스크립트가 없으면 offset부터 8초.
 */
export function clipRange(offsetSec, segments = [], { lead = 1, tail = 1.5, minLen = 4, maxLen = 20 } = {}) {
  const start = Math.max(0, offsetSec - lead);
  let i = segments.findIndex((s) => s.start <= offsetSec + 0.05 && offsetSec < s.end);
  if (i < 0) i = segments.findIndex((s) => s.start >= offsetSec);
  let end = offsetSec + 8;
  if (i >= 0) {
    end = segments[i].end;
    while (end - offsetSec < minLen && i + 1 < segments.length) end = segments[++i].end;
    end += tail;
  }
  return { start, end: Math.min(end, start + maxLen) };
}

/** main.js의 안전한 el()을 주입받아 사용 */
export function initPlayer(elFn) {
  el = elFn;
  audio = $('d-audio');
  $('p-back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
  $('p-fwd').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); });
  $('p-speeds').replaceChildren(...SPEEDS.map((s) => el('button', { type: 'button', 'data-speed': s, onclick: () => setSpeed(s) }, `${s}x`)));
  audio.addEventListener('timeupdate', () => {
    if (clip && audio.currentTime >= clip.end) audio.pause(); // 구간 끝에서 자동 정지
    timeListener?.(audio.currentTime);
  });
  // 어떤 방법으로든 멈추면(정지 버튼·기본 컨트롤·구간 끝) 구간 재생 상태 해제
  for (const ev of ['pause', 'ended']) audio.addEventListener(ev, () => setClip(null));
}

function setSpeed(s) {
  audio.playbackRate = s;
  for (const b of $('p-speeds').children) b.classList.toggle('on', Number(b.dataset.speed) === s);
}

function setClip(c) {
  if (clip?.key === c?.key) { clip = c; return; }
  clip = c;
  clipListener?.(clip?.key ?? null);
}

/** 상세 화면 진입 시 호출. onTime(sec): 재생 위치 알림, onClip(key|null): 구간 재생 상태 변경 알림 */
export function loadPlayer(hasAudio, onTime = null, onClip = null) {
  $('player').hidden = !hasAudio;
  timeListener = onTime;
  clipListener = onClip;
  clip = null;
  setSpeed(1);
}

/** 지정 위치부터 계속 재생(스크립트 줄) */
export function seek(sec, { lead = 1 } = {}) {
  if (!audio?.src || !Number.isFinite(sec)) return;
  setClip(null);
  audio.currentTime = Math.max(0, sec - lead);
  audio.play().catch(() => {});
}

/** 구간 재생/정지 전환. 같은 key가 재생 중이면 정지, 아니면 그 구간을 재생 */
export function toggleClip(key, range) {
  if (!audio?.src) return;
  if (clip?.key === key && !audio.paused) { audio.pause(); return; }
  audio.currentTime = range.start;
  setClip({ key, end: range.end });
  audio.play().catch(() => setClip(null));
}

export const activeClip = () => clip?.key ?? null;

export function unloadPlayer() { timeListener = null; clipListener = null; clip = null; }
