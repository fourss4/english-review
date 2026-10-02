// 수업 상세의 녹음 플레이어: 속도, ±5초, 원하는 위치 재생(스크립트·항목에서 호출). ADR 0007로 구간 저장·내 목소리 녹음 제거.
const SPEEDS = [0.75, 1, 1.25];
const $ = (id) => document.getElementById(id);

let audio, el, timeListener = null;

/** main.js의 안전한 el()을 주입받아 사용 */
export function initPlayer(elFn) {
  el = elFn;
  audio = $('d-audio');
  $('p-back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
  $('p-fwd').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); });
  $('p-speeds').replaceChildren(...SPEEDS.map((s) => el('button', { type: 'button', 'data-speed': s, onclick: () => setSpeed(s) }, `${s}x`)));
  audio.addEventListener('timeupdate', () => timeListener?.(audio.currentTime));
}

function setSpeed(s) {
  audio.playbackRate = s;
  for (const b of $('p-speeds').children) b.classList.toggle('on', Number(b.dataset.speed) === s);
}

/** 상세 화면 진입 시 호출. onTime(sec): 재생 위치 변경 알림(스크립트 강조용) */
export function loadPlayer(hasAudio, onTime = null) {
  $('player').hidden = !hasAudio;
  timeListener = onTime;
  setSpeed(1);
}

/** 지정 위치부터 재생(1초 앞에서 시작해 문맥을 듣게 함) */
export function seek(sec, { lead = 1 } = {}) {
  if (!audio?.src || !Number.isFinite(sec)) return;
  audio.currentTime = Math.max(0, sec - lead);
  audio.play().catch(() => {});
}

export function unloadPlayer() { timeListener = null; }
