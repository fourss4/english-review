// 수업 상세의 녹음 플레이어: 앞뒤 이동, 속도, A-B 반복, 구간 북마크(WebVTT), 쉐도잉 녹음
import { fmtClock, bookmarksToVtt, loopTarget } from './vtt.js';
import { listBookmarks, putBookmark, deleteBookmark } from './db.js';

const SPEEDS = [0.75, 1, 1.25];
const $ = (id) => document.getElementById(id);

let audio, lesson, loop = null, pendingA = null;
let rec = null, recChunks = [], mineUrl = null;
let el;

/** main.js의 안전한 el()을 주입받아 사용 */
export function initPlayer(elFn) {
  el = elFn;
  audio = $('d-audio');
  audio.addEventListener('timeupdate', () => {
    const t = loopTarget(audio.currentTime, loop);
    if (t !== null && !audio.paused) audio.currentTime = t;
  });
  $('p-back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
  $('p-fwd').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); });
  $('p-speeds').replaceChildren(...SPEEDS.map((s) => el('button', { type: 'button', 'data-speed': s, onclick: () => setSpeed(s) }, `${s}x`)));
  $('p-a').addEventListener('click', () => { pendingA = audio.currentTime; loop = null; renderLoop(); });
  $('p-b').addEventListener('click', () => {
    if (pendingA === null) return;
    const [s, e] = [pendingA, audio.currentTime].sort((x, y) => x - y);
    if (e - s < 0.5) return;
    loop = { startSec: s, endSec: e }; pendingA = null;
    audio.currentTime = s; audio.play().catch(() => {});
    renderLoop();
  });
  $('p-clear').addEventListener('click', () => { loop = null; pendingA = null; renderLoop(); });
  $('p-save').addEventListener('click', saveLoop);
  $('p-vtt').addEventListener('click', exportVtt);
  $('p-rec').addEventListener('click', toggleRecord);
  $('p-compare').addEventListener('click', compare);
}

function setSpeed(s) {
  audio.playbackRate = s;
  for (const b of $('p-speeds').children) b.classList.toggle('on', Number(b.dataset.speed) === s);
}

function renderLoop() {
  $('p-status').textContent = loop ? `반복 중 ${fmtClock(loop.startSec)} → ${fmtClock(loop.endSec)}`
    : pendingA !== null ? `A ${fmtClock(pendingA)} — 끝 지점에서 B를 누르세요` : '';
  $('p-save').disabled = !loop;
  $('p-compare').disabled = !loop || !mineUrl;
}

/** 상세 화면 진입 시 호출 */
export async function loadPlayer(l, hasAudio) {
  lesson = l; loop = null; pendingA = null;
  stopRecording(true);
  $('player').hidden = !hasAudio;
  setSpeed(1);
  renderLoop();
  await renderBookmarks();
}

/** 상세 화면 이탈 시 정리 */
export function unloadPlayer() {
  loop = null; pendingA = null;
  stopRecording(true);
}

async function renderBookmarks() {
  const bms = (await listBookmarks(lesson.id)).sort((a, b) => a.startSec - b.startSec);
  $('p-bookmarks').replaceChildren(...(bms.length ? bms.map((b) => el('li', { class: 'bm' },
    el('button', { type: 'button', class: 'link', onclick: () => { loop = { startSec: b.startSec, endSec: b.endSec }; audio.currentTime = b.startSec; audio.play().catch(() => {}); renderLoop(); } },
      `▶ ${fmtClock(b.startSec)}–${fmtClock(b.endSec)}`),
    el('span', {}, ` ${b.label || ''}`),
    el('button', { type: 'button', class: 'link danger-text', 'aria-label': '구간 삭제', onclick: async () => {
      if (confirm('이 구간을 삭제할까요?')) { await deleteBookmark(b.id); renderBookmarks(); }
    } }, '삭제'))) : [el('li', { class: 'muted' }, 'A·B로 구간을 정한 뒤 "구간 저장"을 누르세요.')]));
  $('p-vtt').disabled = bms.length === 0;
}

async function saveLoop() {
  if (!loop) return;
  const label = ($('p-label').value || '').trim().slice(0, 200);
  await putBookmark({
    id: `bm_${Date.now().toString(36)}`, lessonId: lesson.id,
    startSec: Math.round(loop.startSec * 1000) / 1000, endSec: Math.round(loop.endSec * 1000) / 1000,
    label, createdAt: new Date().toISOString(),
  });
  $('p-label').value = '';
  renderBookmarks();
}

async function exportVtt() {
  const vtt = bookmarksToVtt(await listBookmarks(lesson.id));
  const a = el('a', { href: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' })), download: `${lesson.id}-bookmarks.vtt` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- 쉐도잉: 내 목소리 녹음(기기 메모리에만, 저장하지 않음) ----
async function toggleRecord() {
  if (rec && rec.state === 'recording') { stopRecording(false); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    $('p-rec-msg').textContent = '이 브라우저는 녹음을 지원하지 않습니다.'; return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    const r = new MediaRecorder(stream);
    rec = r;
    r.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (r !== rec || !recChunks.length) return; // 화면 이탈로 폐기된 녹음
      if (mineUrl) URL.revokeObjectURL(mineUrl);
      mineUrl = URL.createObjectURL(new Blob(recChunks, { type: r.mimeType }));
      $('p-mine').src = mineUrl; $('p-mine').hidden = false;
      $('p-rec-msg').textContent = '녹음 완료. 원본 구간과 번갈아 들어 보세요.';
      renderLoop();
    };
    audio.pause();
    r.start();
    $('p-rec').textContent = '■ 녹음 멈추기';
    $('p-rec-msg').textContent = '녹음 중… (이 녹음은 저장되지 않습니다)';
  } catch {
    $('p-rec-msg').textContent = '마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.';
  }
}

function stopRecording(discard) {
  if (rec && rec.state === 'recording') rec.stop();
  $('p-rec').textContent = '● 내 목소리 녹음';
  if (discard) {
    rec = null; recChunks = [];
    if (mineUrl) { URL.revokeObjectURL(mineUrl); mineUrl = null; }
    $('p-mine').removeAttribute('src'); $('p-mine').hidden = true; $('p-rec-msg').textContent = '';
  }
}

/** 원본 A-B 구간을 한 번 재생한 뒤 내 녹음 재생 */
function compare() {
  if (!loop || !mineUrl) return;
  const seg = { ...loop };
  loop = null; renderLoop();
  audio.currentTime = seg.startSec;
  const onTime = () => {
    if (audio.currentTime >= seg.endSec) {
      audio.pause(); audio.removeEventListener('timeupdate', onTime);
      $('p-mine').currentTime = 0; $('p-mine').play().catch(() => {});
      $('p-mine').addEventListener('ended', () => { loop = seg; renderLoop(); }, { once: true });
    }
  };
  audio.addEventListener('timeupdate', onTime);
  audio.play().catch(() => {});
}
