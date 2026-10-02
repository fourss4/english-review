// 화면 로직 (v0.8, ADR 0006·0007). 사용자 데이터는 모두 textContent로만 출력(innerHTML 미사용, XSS 방지)
import { buildLesson, parseFileName, validateLesson } from './parser/langdy-v1.js';
import {
  saveLesson, putLesson, listLessons, getLesson, getAudio, purgeLesson, storageInfo, putCards, listCards, cardsByLesson,
  deleteCards, putSummary, listSummaries, deleteSummary, getMeta, setMeta,
} from './db.js';
import { lessonItems, variantsFor, pickVariant, checkTyped, shuffled, syncLessonCards, migrateLegacyCards, toAnkiTsv, TYPE_LABEL, KIND_LABEL } from './cards.js';
import { GRADES, review, previewIntervals, buildQueue, buildWrongQueue, localDate, isNew } from './srs.js';
import { initPlayer, loadPlayer, unloadPlayer, seek } from './player.js';
import { searchLessons, splitByRanges } from './search.js';
import { readPackage, PackageError } from './package.js';
import { exportProgress, parseProgress, mergeProgress } from './progress.js';
import { migrate, CURRENT_SCHEMA } from './migrations.js';
import { fmtClock } from './vtt.js';
import { APP_VERSION } from './version.js';
import { maskPersonal, buildStructurePrompt, extractJson, validateStructure, mergeStructure } from './ai-structure.js';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_SEC = 3 * 60 * 60;
const MAX_TEXT_CHARS = 100_000;
const MAX_PROGRESS_BYTES = 20 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

/** 안전한 요소 생성: 문자열 자식은 텍스트 노드로만 추가 */
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)}MB`;
const ymd = () => localDate().replace(/-/g, '');

// ---------- 화면 전환 ----------
let currentAudioUrl = null;
function show(view) {
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${view}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === view);
  if (view !== 'detail') {
    stopOpic();
    unloadPlayer();
    $('d-audio').pause();
    if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; $('d-audio').removeAttribute('src'); }
  }
  if (view === 'list') renderList();
  if (view === 'review') renderReviewHome();
  if (view === 'settings') renderSettings();
  if (view === 'trash') renderTrash();
  window.scrollTo(0, 0);
}
for (const t of document.querySelectorAll('.tab, .go')) t.addEventListener('click', () => show(t.dataset.view));
$('back').addEventListener('click', () => show('list'));

// ---------- 공통 표시 ----------
const CATEGORY = { slang: '슬랭', idiom: '관용구', better_expression: '더 좋은 표현' };
const REGISTER = { casual: '편한 자리', neutral: '어디서나', formal: '격식' };

function lessonLabel(l) { return l.title || l.id; }
function lessonMeta(l) {
  return [l.date?.slice(0, 10), l.course && `${l.course}${l.lessonNo !== undefined ? ` #${l.lessonNo}` : ''}`,
    `업그레이드 ${(l.upgrades || []).length} · 교정 ${(l.corrections || []).length} · 표현 ${(l.expressions || []).length}`].filter(Boolean).join(' · ');
}
function exampleNodes(ex = []) {
  return ex.map((e) => el('div', { class: 'ex' }, e.speaker ? `${e.speaker}. ${e.en}` : e.en, e.ko ? el('div', { class: 'tip' }, e.ko) : null));
}
const aiBadge = () => el('span', { class: 'badge soft', title: 'AI가 만든 내용입니다. 선생님 확인 전이니 참고용으로 보세요.' }, 'AI 생성');

// ---------- 목록 ----------
async function renderList() {
  const all = (await listLessons()).filter((l) => !l.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  $('lessons').replaceChildren(...all.map((l) => el('li', { class: 'card' },
    el('h3', {}, lessonLabel(l)), el('div', { class: 'muted' }, lessonMeta(l)),
    el('button', { type: 'button', onclick: () => openDetail(l.id) }, '열기'))));
  $('empty').hidden = all.length > 0;
  await renderWeeklies();
  const s = await storageInfo();
  $('storage').textContent = s.usage !== null
    ? `저장 공간 사용 ${fmtMB(s.usage)} / 허용 ${fmtMB(s.quota)}${s.persisted ? ' · 자동 정리 보호됨' : ''}` : '';
  if ($('q').value.trim()) runSearch();
}

async function renderWeeklies() {
  const ws = (await listSummaries()).sort((a, b) => b.to.localeCompare(a.to));
  $('weeklies').replaceChildren(...ws.map((w, i) => {
    const d = el('details', { class: 'card weekly' },
      el('summary', {}, `주간 요약 · ${w.from} ~ ${w.to} · 수업 ${w.lessonIds.length}개`),
      w.highlightsKo.length ? el('ul', {}, ...w.highlightsKo.map((h) => el('li', {}, h))) : null,
      w.topExpressions?.length ? el('div', {}, el('h4', {}, '이번 주 핵심 표현'),
        ...w.topExpressions.map((x) => el('div', { class: 'ex' }, el('strong', {}, x.text), x.meaningKo ? ` — ${x.meaningKo}` : ''))) : null,
      w.repeatedMistakes?.length ? el('div', {}, el('h4', {}, '반복되는 실수'),
        ...w.repeatedMistakes.map((m) => el('div', { class: 'item' }, el('strong', {}, m.patternKo),
          m.tipKo ? el('div', { class: 'tip' }, m.tipKo) : null,
          ...(m.examples || []).map((x) => el('div', {}, el('span', { class: 'bad' }, x.original || ''), ' → ', el('span', { class: 'good' }, x.corrected || '')))))) : null,
      w.focusNextWeekKo?.length ? el('div', {}, el('h4', {}, '다음 주 집중할 것'), el('ul', {}, ...w.focusNextWeekKo.map((f) => el('li', {}, f)))) : null,
      el('button', { type: 'button', class: 'link danger-text', onclick: async () => {
        if (confirm('이 주간 요약을 지울까요? (PC의 weekly ZIP으로 다시 가져올 수 있습니다)')) { await deleteSummary(w.id); renderWeeklies(); }
      } }, '요약 지우기'));
    if (i === 0) d.open = true;
    return d;
  }));
}

// ---------- 검색 ----------
let searchTimer = null;
$('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); });

async function runSearch() {
  const q = $('q').value;
  const box = $('q-results');
  const active = q.trim().length >= 2;
  box.hidden = !active; $('lessons').hidden = active; $('weeklies').hidden = active;
  $('empty').hidden = active || $('lessons').children.length > 0;
  if (!active) return;
  const res = searchLessons(await listLessons(), q);
  if (!res.length) { box.replaceChildren(el('p', { class: 'muted' }, '검색 결과가 없습니다.')); return; }
  box.replaceChildren(...res.map(({ lesson, hits }) => el('div', { class: 'card' },
    el('h3', {}, lessonLabel(lesson)), el('div', { class: 'muted' }, lesson.date.slice(0, 10)),
    ...hits.slice(0, 8).map((h) => el('div', { class: 'hit' }, el('small', {}, h.label),
      ...splitByRanges(h.text, h.ranges).map((p) => (p.hit ? el('mark', {}, p.text) : p.text)))),
    hits.length > 8 ? el('div', { class: 'muted' }, `외 ${hits.length - 8}건`) : null,
    el('button', { type: 'button', onclick: () => openDetail(lesson.id) }, '수업 열기'))));
}

// ---------- 상세 ----------
let detail = { lesson: null, hasAudio: false, segEls: [], segIdx: -1 };

function playBtn(sec) {
  if (!detail.hasAudio || !Number.isFinite(sec)) return null;
  return el('button', { type: 'button', class: 'link play', onclick: () => seek(sec) }, `▶ ${fmtClock(sec)}`);
}

function hideToggle(ref) {
  const l = detail.lesson;
  const hidden = (l.hidden || []).includes(ref);
  return el('button', { type: 'button', class: 'link small', onclick: async () => {
    const set = new Set(l.hidden || []);
    if (set.has(ref)) set.delete(ref); else set.add(ref);
    l.hidden = [...set];
    await putLesson(l);
    await syncCards(l);
    renderDetailBody();
  } }, hidden ? '복습에 다시 넣기' : '복습에서 빼기');
}

function itemBox(ref, title, ...children) {
  const hidden = (detail.lesson.hidden || []).includes(ref);
  return el('div', { class: `item${hidden ? ' off' : ''}` },
    el('div', { class: 'row-between' }, el('h4', {}, title, hidden ? ' (복습 제외)' : ''), hideToggle(ref)), ...children);
}

function section(title, note, nodes) {
  if (!nodes.length) return [];
  return [el('h3', { class: 'sec' }, title), ...(note ? [el('p', { class: 'muted' }, note)] : []), ...nodes];
}

function renderDetailBody() {
  const l = detail.lesson;
  const ups = (l.upgrades || []).map((u, i) => itemBox(u.id, `업그레이드 ${i + 1} · ${CATEGORY[u.category] || u.category}${u.register ? ` · ${REGISTER[u.register] || u.register}` : ''}`,
    el('div', { class: 'said' }, el('small', {}, '내가 한 말 '), u.original, ' ', playBtn(u.offsetSec)),
    el('div', { class: 'good big' }, '→ ', u.suggestion),
    u.meaningKo ? el('div', {}, u.meaningKo) : null,
    u.explanationKo ? el('div', { class: 'tip' }, u.explanationKo) : null,
    ...exampleNodes(u.examples)));
  const cors = (l.corrections || []).map((c, i) => itemBox(c.id, `교정 ${i + 1}`,
    el('div', { class: 'bad' }, '❌ ', c.original, ' ', playBtn(c.offsetSec)),
    el('div', { class: 'good' }, '✅ ', c.corrected, ' ', c.ai?.corrected ? aiBadge() : null),
    c.natural ? el('div', { class: 'good' }, '✨ ', c.natural, ' ', c.ai?.natural ? aiBadge() : null) : null,
    c.meaningKo ? el('div', { class: 'tip' }, `뜻: ${c.meaningKo}`) : null,
    c.explanationKo ? el('div', { class: 'tip pre' }, `💡 ${c.explanationKo}`) : null));
  const exps = (l.expressions || []).map((e) => itemBox(e.id, e.isKey ? '핵심 표현' : '표현',
    el('strong', {}, e.text), e.pattern ? el('div', { class: 'tip' }, `패턴: ${e.pattern}`) : null,
    e.meaningKo ? el('div', {}, e.meaningKo) : null,
    e.definition ? el('div', { class: 'tip' }, e.definition) : null,
    ...exampleNodes(e.examples)));

  const body = [
    ...section('표현 업그레이드', '내가 수업에서 한 말을 OPIc IH 수준의 슬랭·관용구·더 좋은 표현으로 바꿔 봤어요.', ups),
    ...section('교정', null, cors),
    ...section('표현', null, exps),
    ...renderPrep(l),
    ...renderOpic(l),
  ];
  if (!ups.length && !cors.length && !exps.length) body.unshift(el('p', { class: 'muted' }, '정리된 항목이 없습니다.'));
  $('d-body').replaceChildren(...body.filter(Boolean));
}

function renderPrep(l) {
  const p = l.prep;
  if (!p || (!p.expressions?.length && !p.questions?.length)) return [];
  return [el('h3', { class: 'sec' }, '다음 수업 준비'), el('div', { class: 'item prep' },
    p.expressions?.length ? el('div', {}, el('h4', {}, '다음 수업에서 써 볼 표현'),
      ...p.expressions.map((x) => el('div', { class: 'ex' }, el('strong', {}, x.text), x.howToUseKo ? el('div', { class: 'tip' }, x.howToUseKo) : null))) : null,
    p.questions?.length ? el('div', {}, el('h4', {}, '선생님께 물어볼 것'), el('ul', {}, ...p.questions.map((q) => el('li', {}, q)))) : null)];
}

// ---------- OPIc 모의 답변 ----------
let opicTimer = null;
function stopOpic() { if (opicTimer) { clearInterval(opicTimer); opicTimer = null; } }

function renderOpic(l) {
  if (!l.opic?.length) return [];
  const items = lessonItems(l, { includeHidden: true });
  const label = (ref) => items.find((x) => x.ref === ref)?.main;
  return [el('h3', { class: 'sec' }, 'OPIc 모의 답변'),
    el('p', { class: 'muted' }, '질문을 보고 소리 내어 답해 보세요. 목표 표현을 쓸 때마다 눌러 표시합니다(기록은 저장되지 않습니다).'),
    ...l.opic.map((q) => {
      const box = el('div', { class: 'opic-run' });
      const sec = q.seconds || 120;
      const start = () => {
        stopOpic();
        for (const b of document.querySelectorAll('.opic-run')) b.replaceChildren();
        let left = sec;
        const clock = el('div', { class: 'timer' }, fmtClock(left));
        const stopBtn = el('button', { type: 'button', onclick: () => { stopOpic(); clock.textContent += ' · 멈춤'; } }, '멈추기');
        box.replaceChildren(
          q.structureKo?.length ? el('ol', { class: 'steps' }, ...q.structureKo.map((s) => el('li', {}, s))) : null,
          q.targetRefs?.length ? el('div', { class: 'chips' }, ...q.targetRefs.map(label).filter(Boolean).map((t) => {
            const chip = el('button', { type: 'button', class: 'chip', onclick: () => chip.classList.toggle('on') }, t);
            return chip;
          })) : null,
          el('div', { class: 'row-between' }, clock, stopBtn));
        opicTimer = setInterval(() => {
          left -= 1;
          clock.textContent = fmtClock(Math.max(0, left));
          if (left <= 0) { stopOpic(); clock.textContent = '시간 종료 · 목표 표현을 몇 개 썼나요?'; }
        }, 1000);
      };
      return el('div', { class: 'item' },
        el('div', {}, el('strong', {}, q.question)),
        q.questionKo ? el('details', { class: 'mini' }, el('summary', {}, '한국어로 보기'), el('div', { class: 'tip' }, q.questionKo)) : null,
        el('button', { type: 'button', class: 'primary opic-start', onclick: start }, `답변 연습 시작 (${fmtClock(sec)})`),
        box);
    })];
}

// ---------- 스크립트 ----------
function renderTranscript(l) {
  const segs = l.transcript?.segments || [];
  $('d-tr-wrap').hidden = !segs.length; $('d-tr-wrap').open = false;
  $('d-tr-sum').textContent = `스크립트 (${segs.length}줄)`;
  detail.segEls = segs.map((s) => el('li', {}, el('button', { type: 'button', class: 'seg-line', onclick: () => seek(s.start, { lead: 0 }) },
    el('small', {}, fmtClock(s.start)), ' ', s.text)));
  detail.segIdx = -1;
  $('d-tr').replaceChildren(...detail.segEls);
}

function onTime(t) {
  const segs = detail.lesson?.transcript?.segments;
  if (!segs?.length || !$('d-tr-wrap').open) return;
  let lo = 0, hi = segs.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m].start <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx === detail.segIdx) return;
  detail.segEls[detail.segIdx]?.classList.remove('now');
  detail.segIdx = idx;
  detail.segEls[idx]?.classList.add('now');
}

async function openDetail(id) {
  const l = await getLesson(id);
  if (!l) return show('list');
  show('detail');
  detail = { lesson: l, hasAudio: false, segEls: [], segIdx: -1 };
  $('d-title').textContent = lessonLabel(l);
  $('d-meta').textContent = lessonMeta(l);
  const a = await getAudio(l.id);
  const audio = $('d-audio');
  audio.hidden = !a;
  detail.hasAudio = !!a;
  if (a) { currentAudioUrl = URL.createObjectURL(a.blob); audio.src = currentAudioUrl; }
  loadPlayer(!!a, onTime);
  renderDetailBody();
  renderTranscript(l);
  const raw = l.source?.raw || {};
  $('d-chat-wrap').hidden = !(raw.chat || '').trim(); $('d-chat-wrap').open = false; $('d-chat').textContent = raw.chat || '';
  $('d-comment-wrap').hidden = !(raw.comment || '').trim(); $('d-comment-wrap').open = false; $('d-comment').textContent = raw.comment || '';
  $('d-review').onclick = () => startSession({ mode: 'lesson', lessonId: l.id });
  $('d-delete').onclick = async () => {
    await putLesson({ ...l, deletedAt: new Date().toISOString() });
    show('list');
  };
}

// ---------- 휴지통 ----------
async function renderTrash() {
  const del = (await listLessons()).filter((l) => l.deletedAt);
  $('trash').replaceChildren(...(del.length ? del.map((l) => el('li', { class: 'card' },
    el('h3', {}, lessonLabel(l)), el('div', { class: 'muted' }, `삭제: ${l.deletedAt.slice(0, 10)}`),
    el('button', { type: 'button', onclick: async () => { const r = { ...l }; delete r.deletedAt; await putLesson(r); renderTrash(); } }, '복원'),
    el('button', { type: 'button', class: 'danger', onclick: async () => {
      if (confirm('영구 삭제하면 이 수업의 녹음과 학습 기록도 사라집니다. 삭제할까요?')) { await purgeLesson(l.id); renderTrash(); }
    } }, '영구 삭제'))) : [el('li', { class: 'muted' }, '비어 있음')]));
}

// ---------- 패키지 가져오기 ----------
async function importLessonPackage(p) {
  const l = p.lesson;
  const old = await getLesson(l.id);
  if (old && !old.deletedAt && !confirm(`이미 있는 수업입니다: ${lessonLabel(old)}\n새 패키지 내용으로 바꿀까요? (복습 기록은 유지)`)) return '건너뜀';
  if (old?.hidden?.length) l.hidden = old.hidden;
  await saveLesson(l, p.audio?.blob);
  await syncCards(l);
  return old ? '교체함' : '추가함';
}

$('pk-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const out = $('pk-out');
  out.replaceChildren();
  for (const f of files) {
    const line = el('div', { class: 'card' }, el('strong', {}, f.name), el('div', { class: 'muted' }, '확인 중…'));
    out.append(line);
    const status = line.lastChild;
    try {
      const p = await readPackage(f);
      if (p.kind === 'weekly') {
        await putSummary({ ...p.weekly, importedAt: new Date().toISOString() });
        status.textContent = `주간 요약 ${p.weekly.from} ~ ${p.weekly.to} 추가함 (수업 탭에서 확인)`;
      } else {
        const r = await importLessonPackage(p);
        const l = p.lesson;
        status.textContent = `${r}: ${lessonLabel(l)} · 업그레이드 ${l.upgrades.length} · 교정 ${l.corrections.length} · 표현 ${l.expressions.length} · 문제 ${l.exercises.length}${p.audio ? ` · 녹음 ${fmtMB(p.audio.blob.size)}` : ''}`;
        if (r !== '건너뜀') line.append(el('button', { type: 'button', onclick: () => openDetail(l.id) }, '수업 열기'));
      }
      status.className = 'good';
    } catch (err) {
      status.className = 'bad';
      status.textContent = err instanceof PackageError ? err.message
        : err?.name === 'QuotaExceededError' ? '저장 공간이 부족합니다.' : '가져오지 못했습니다. 파일을 확인해 주세요.';
    }
  }
  e.target.value = '';
});

// ---------- 직접 입력(예비) ----------
let audioFile = null;
let audioProbe = null;
let draft = null;
let lastReport = null;

function probeAudio(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const finish = (fn, val) => { clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute('src'); fn(val); };
    const t = setTimeout(() => finish(reject, new Error('파일 정보를 읽지 못했습니다(시간 초과).')), 15000);
    v.preload = 'metadata';
    v.onloadedmetadata = () => finish(resolve, { durationSec: Math.round(v.duration * 10) / 10, hasVideo: v.videoWidth > 0 });
    v.onerror = () => finish(reject, new Error('재생할 수 없는 파일 형식입니다.'));
    v.src = url;
  });
}

$('f-audio').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  audioFile = null; audioProbe = null;
  const info = $('f-audio-info');
  if (!f) { info.textContent = ''; return; }
  if (!/\.(mp4|m4a)$/i.test(f.name)) { info.textContent = 'mp4 또는 m4a 파일만 가져올 수 있습니다.'; return; }
  if (f.size > MAX_AUDIO_BYTES) { info.textContent = `파일이 너무 큽니다(최대 ${fmtMB(MAX_AUDIO_BYTES)}).`; return; }
  info.textContent = '파일 확인 중...';
  try {
    const p = await probeAudio(f);
    if (!Number.isFinite(p.durationSec) || p.durationSec <= 0 || p.durationSec > MAX_AUDIO_SEC) throw new Error('녹음 길이를 확인할 수 없습니다.');
    audioFile = f; audioProbe = p;
    const fn = parseFileName(f.name);
    if (fn.date) $('f-date').value = fn.date;
    info.textContent = `${fmtMB(f.size)} · ${Math.floor(p.durationSec / 60)}분 ${Math.round(p.durationSec % 60)}초${p.hasVideo ? ' · 영상 포함' : ' · 오디오'}`;
  } catch (err) {
    info.textContent = err.message;
  }
});

async function nextSeq(dateStr) {
  const prefix = `les_${dateStr.replace(/-/g, '')}_`;
  const nums = (await listLessons()).filter((l) => l.id.startsWith(prefix)).map((l) => Number(l.id.slice(prefix.length)) || 0);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

$('import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const chat = $('f-chat').value, comment = $('f-comment').value;
  const msg = $('import-msg');
  if (chat.length > MAX_TEXT_CHARS || comment.length > MAX_TEXT_CHARS) { msg.textContent = '붙여넣은 텍스트가 너무 깁니다.'; return; }
  if (!audioFile && !chat.trim() && !comment.trim()) { msg.textContent = '녹음 파일이나 텍스트 중 하나는 있어야 합니다.'; return; }
  msg.textContent = '';
  const dateStr = $('f-date').value || parseFileName(audioFile?.name || '').date || localDate();
  const { lesson, report } = buildLesson({ fileName: audioFile?.name || '', chat, comment, fallbackDate: dateStr, seq: await nextSeq(dateStr) });
  if ($('f-date').value && !lesson.id.includes($('f-date').value.replace(/-/g, ''))) {
    lesson.date = `${dateStr}T00:00:00+09:00`;
    lesson.id = `les_${dateStr.replace(/-/g, '')}_${String(await nextSeq(dateStr)).padStart(2, '0')}`;
  }
  if (audioProbe) {
    lesson.durationSec = audioProbe.durationSec;
    lesson.audio.durationSec = audioProbe.durationSec;
    lesson.audio.mimeType = audioProbe.hasVideo ? 'video/mp4' : 'audio/mp4';
  }
  draft = lesson;
  lastReport = report;
  resetAiPanel();
  const noMarks = lesson.corrections.length === 0 && chat.trim().length > 0;
  $('ai-hint').hidden = !noMarks;
  $('ai-panel').open = noMarks;
  if (noMarks) $('ai-msg').textContent = '채팅에서 ❌✅💡 기호를 찾지 못해 교정이 비어 있습니다. AI로 찾아 보세요.';
  renderPreview(report);
});

function field(label, value, onInput, { multiline = false, type = 'text' } = {}) {
  const input = multiline ? el('textarea', { rows: 3 }) : el('input', { type });
  input.value = value ?? '';
  input.addEventListener('input', () => onInput(input.value));
  return el('label', {}, label, input);
}
function setOpt(obj, key, v) { if (v.trim()) obj[key] = v; else delete obj[key]; }

function renderPreview(report = lastReport) {
  const r = [];
  if (report.warnings.length) r.push(el('div', { class: 'warn' }, '확인 필요: ', report.warnings.join(' / ')));
  if (report.suspiciousWords.length) {
    r.push(el('div', { class: 'warn' }, '코멘트에 글자 인식(OCR) 오류로 보이는 단어가 있습니다.',
      el('div', { class: 'chips' }, ...report.suspiciousWords.map((w) => el('span', { class: 'chip' }, w)))));
  }
  $('report').replaceChildren(...r);
  const d = draft;
  const f = [
    field('과정명', d.course, (v) => setOpt(d, 'course', v)),
    field('수업 제목', d.title, (v) => setOpt(d, 'title', v)),
  ];
  d.expressions.forEach((e, i) => {
    f.push(el('div', { class: 'item' }, el('h4', {}, `표현 ${i + 1}`),
      field('표현', e.text, (v) => { e.text = v; }),
      field('한국어 뜻', e.meaning, (v) => setOpt(e, 'meaning', v)),
      el('button', { type: 'button', onclick: () => { d.expressions.splice(i, 1); renderPreview(report); } }, '이 항목 빼기')));
  });
  d.corrections.forEach((c, i) => {
    f.push(el('div', { class: 'item' }, el('h4', {}, `교정 ${i + 1}`),
      field('❌ 틀린 문장', c.original, (v) => { c.original = v; }, { multiline: true }),
      field('✅ 교정', c.corrected, (v) => { c.corrected = v; }, { multiline: true }),
      field('💡 이유', c.explanation, (v) => setOpt(c, 'explanation', v), { multiline: true }),
      field('✨ 더 자연스러운 표현', c.natural, (v) => setOpt(c, 'natural', v), { multiline: true }),
      field('한국어 뜻', c.naturalKo, (v) => setOpt(c, 'naturalKo', v)),
      el('button', { type: 'button', onclick: () => { d.corrections.splice(i, 1); renderPreview(report); } }, '이 항목 빼기')));
  });
  f.push(el('div', { class: 'addrow' },
    el('button', { type: 'button', onclick: () => { d.corrections.push({ id: '', original: '', corrected: '' }); renderPreview(report); } }, '＋ 교정 추가'),
    el('button', { type: 'button', onclick: () => { d.expressions.push({ id: '', text: '' }); renderPreview(report); } }, '＋ 표현 추가')));
  $('pv-fields').replaceChildren(...f);
  $('preview').hidden = false;
  $('import-form').hidden = true;
}

let promptTemplate = null;
function resetAiPanel() { $('ai-out').hidden = true; $('ai-prompt').value = ''; $('ai-result').value = ''; $('ai-msg').textContent = ''; }
getMeta('maskWords', '').then((v) => { $('ai-mask').value = v; }).catch(() => {});

$('ai-make').addEventListener('click', async () => {
  const msg = $('ai-msg');
  try {
    if (!promptTemplate) {
      const res = await fetch('prompts/chat-structure.md');
      if (!res.ok) throw new Error();
      promptTemplate = await res.text();
    }
  } catch { msg.textContent = '요청 문장 템플릿을 불러오지 못했습니다. 앱을 한 번 온라인으로 연 뒤 다시 시도하세요.'; return; }
  const words = $('ai-mask').value.split(',').map((s) => s.trim()).filter(Boolean);
  await setMeta('maskWords', words.join(', '));
  const raw = draft.source?.raw || {};
  if (!(raw.chat || '').trim() && !(raw.comment || '').trim()) { msg.textContent = '채팅이나 코멘트를 붙여넣은 경우에만 사용할 수 있습니다.'; return; }
  const chat = maskPersonal(raw.chat || '', words), comment = maskPersonal(raw.comment || '', words);
  $('ai-prompt').value = buildStructurePrompt(promptTemplate, { chat: chat.text, comment: comment.text });
  const n = chat.count + comment.count;
  $('ai-mask-info').textContent = `아래 내용이 AI로 전달됩니다. ${n ? `가린 곳 ${n}군데. ` : ''}이름 등 보내고 싶지 않은 내용이 남아 있으면 위 칸에 추가하고 다시 만드세요.`;
  $('ai-out').hidden = false;
  msg.textContent = '';
});

$('ai-copy').addEventListener('click', async () => {
  const ta = $('ai-prompt');
  try { await navigator.clipboard.writeText(ta.value); $('ai-msg').textContent = '복사했습니다. AI 채팅에 붙여넣으세요.'; }
  catch { ta.focus(); ta.select(); $('ai-msg').textContent = '자동 복사가 안 됩니다. 선택된 글을 길게 눌러 복사하세요.'; }
});

$('ai-apply').addEventListener('click', () => {
  const msg = $('ai-msg');
  try {
    const { data, warnings } = validateStructure(extractJson($('ai-result').value));
    const provider = $('ai-provider').value.trim().slice(0, 40) || undefined;
    const r = mergeStructure(draft, data, { provider });
    draft = r.lesson;
    renderPreview();
    msg.textContent = `적용했습니다: 교정 ${r.added.corrections}개·표현 ${r.added.expressions}개 추가, 빈 칸 ${r.filled}개 채움.`
      + (warnings.length ? ` (${warnings.join(' / ')})` : '') + ' 확인한 뒤 저장하세요.';
    $('ai-hint').hidden = true;
  } catch (err) {
    msg.textContent = err?.message || '결과를 적용하지 못했습니다.';
  }
});

function resetImport() {
  draft = null; audioFile = null; audioProbe = null; lastReport = null; resetAiPanel(); $('ai-panel').open = false;
  $('import-form').reset(); $('f-audio-info').textContent = '';
  $('preview').hidden = true; $('import-form').hidden = false;
}

$('pv-cancel').addEventListener('click', () => { $('preview').hidden = true; $('import-form').hidden = false; });
$('pv-save').addEventListener('click', async () => {
  const msg = $('import-msg');
  const d = draft;
  d.expressions = d.expressions.filter((e) => e.text?.trim());
  d.corrections = d.corrections.filter((c) => c.original?.trim() || c.corrected?.trim());
  d.expressions.forEach((e, i) => { e.id = `exp_${String(i + 1).padStart(2, '0')}`; });
  d.corrections.forEach((c, i) => { c.id = `cor_${String(i + 1).padStart(2, '0')}`; });
  const errs = validateLesson(d);
  if (errs.length) { msg.textContent = `저장할 수 없습니다. 비어 있는 항목: ${errs.join(', ')}`; return; }
  try {
    const v2 = migrate('lesson', d);
    await saveLesson(v2, audioFile);
    await syncCards(v2);
    msg.textContent = '저장했습니다.';
    resetImport();
    openDetail(v2.id);
  } catch (err) {
    console.error('save failed', err?.name);
    msg.textContent = err?.name === 'QuotaExceededError' ? '저장 공간이 부족합니다.' : '저장 중 오류가 발생했습니다.';
  }
});

// ---------- 카드 동기화 ----------
async function syncCards(lesson) {
  await putCards(syncLessonCards(lesson, await cardsByLesson(lesson.id), localDate()));
}

// ---------- 복습 ----------
let session = null;

async function liveLessons() {
  return new Map((await listLessons()).filter((l) => !l.deletedAt).map((l) => [l.id, l]));
}
async function activeCards(lessons) {
  return (await listCards()).filter((c) => lessons.has(c.lessonId));
}
async function newLimitLeft(cards, today) {
  const limit = await getMeta('newPerDay', 20);
  const studiedToday = cards.filter((c) => c.log?.length && localDate(new Date(c.log[0].at)) === today).length;
  return { limit, left: Math.max(0, limit - studiedToday) };
}

async function renderReviewHome() {
  $('rv-home').hidden = false; $('rv-session').hidden = true; $('rv-done').hidden = true;
  const today = localDate();
  const lessons = await liveLessons();
  const cards = await activeCards(lessons);
  const { limit, left } = await newLimitLeft(cards, today);
  const q = buildQueue(cards, today, { newLimit: left });
  const wrong = buildWrongQueue(cards);
  $('rv-due').textContent = q.filter((c) => !isNew(c)).length;
  $('rv-new').textContent = q.filter(isNew).length;
  $('rv-wrongn').textContent = wrong.length;
  $('rv-newlimit').value = limit;
  $('rv-start').disabled = q.length === 0;
  $('rv-wrong').disabled = wrong.length === 0;
  $('rv-note').textContent = !lessons.size ? '"가져오기"에서 수업 패키지를 가져오면 복습 항목이 자동으로 만들어집니다.'
    : q.length === 0 ? '오늘 복습할 항목을 모두 끝냈습니다.' : '';
  renderPrepCard([...lessons.values()]);
}

function renderPrepCard(lessons) {
  const l = lessons.filter((x) => x.prep && (x.prep.expressions?.length || x.prep.questions?.length))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!l) { $('rv-prep').replaceChildren(); return; }
  const p = l.prep;
  $('rv-prep').replaceChildren(el('div', { class: 'card prep' },
    el('h3', {}, '다음 수업 준비'), el('div', { class: 'muted' }, `${lessonLabel(l)} (${l.date.slice(0, 10)}) 기준`),
    ...(p.expressions || []).slice(0, 3).map((x) => el('div', { class: 'ex' }, el('strong', {}, x.text), x.howToUseKo ? el('div', { class: 'tip' }, x.howToUseKo) : null)),
    p.questions?.length ? el('div', { class: 'tip' }, `물어볼 것: ${p.questions[0]}${p.questions.length > 1 ? ` 외 ${p.questions.length - 1}개` : ''}`) : null,
    el('button', { type: 'button', onclick: () => openDetail(l.id) }, '수업에서 자세히 보기')));
}

$('rv-newlimit').addEventListener('change', async (e) => {
  const v = Math.min(200, Math.max(0, parseInt(e.target.value, 10) || 0));
  await setMeta('newPerDay', v); renderReviewHome();
});

$('rv-start').addEventListener('click', () => startSession({ mode: 'normal' }));
$('rv-wrong').addEventListener('click', () => startSession({ mode: 'wrong' }));
$('rv-done-wrong').addEventListener('click', () => startSession({ mode: 'wrong' }));
$('rv-quit').addEventListener('click', () => endSession());
$('rv-done-home').addEventListener('click', () => renderReviewHome());

async function startSession({ mode = 'normal', lessonId } = {}) {
  const today = localDate();
  const lessons = await liveLessons();
  const cards = await activeCards(lessons);
  let queue;
  if (mode === 'lesson') queue = cards.filter((c) => c.lessonId === lessonId && !c.suspended).sort((a, b) => a.ref.localeCompare(b.ref));
  else if (mode === 'wrong') queue = buildWrongQueue(cards);
  else queue = buildQueue(cards, today, { newLimit: (await newLimitLeft(cards, today)).left });
  show('review');
  if (!queue.length) return;
  session = { mode, queue, i: 0, today, lessons, done: 0, right: 0, wrong: 0, requeued: new Set(), avoid: new Map(), cur: null };
  $('rv-home').hidden = true; $('rv-done').hidden = true; $('rv-session').hidden = false;
  renderCard();
}

function endSession() {
  if (!session) return renderReviewHome();
  const s = session;
  session = null;
  $('rv-session').hidden = true; $('rv-home').hidden = true; $('rv-done').hidden = false;
  $('rv-done-msg').textContent = s.done ? `${s.done}문제 풀었습니다 · 맞힘 ${s.right} · 틀림 ${s.wrong}` : '푼 문제가 없습니다.';
  $('rv-done-wrong').hidden = s.mode === 'wrong' || s.wrong === 0;
}

function renderCard() {
  const s = session;
  while (s.i < s.queue.length) {
    const c = s.queue[s.i];
    const l = s.lessons.get(c.lessonId);
    const variants = l ? variantsFor(l, c.ref) : [];
    const avoidType = s.avoid.get(c.id) || (s.mode === 'wrong' ? c.wrong?.lastType : undefined);
    const ex = variants.length ? pickVariant(c, variants, { avoidType }) : null;
    if (ex) { s.cur = { card: c, ex, lesson: l }; break; }
    s.i += 1; // 문제를 만들 수 없는 항목은 건너뜀
  }
  if (s.i >= s.queue.length) return endSession();
  const { card, ex } = s.cur;
  const kind = card.ref.split('_')[0];
  $('rv-progress').textContent = `${s.i + 1} / ${s.queue.length}${s.mode === 'wrong' ? ' · 오답 복습' : s.mode === 'lesson' ? ' · 수업 복습' : ''}`;
  $('rv-kind').textContent = `${KIND_LABEL[kind] || kind} · ${TYPE_LABEL[ex.type] || ex.type}`;
  const ko = ex.promptKo ? (ex.type === 'situation' ? `상황: ${ex.promptKo}` : `뜻: ${ex.promptKo}`) : '';
  $('rv-ko').textContent = ko; $('rv-ko').hidden = !ko;
  $('rv-front').textContent = ex.prompt;
  for (const id of ['rv-result', 'rv-back', 'rv-actions', 'rv-grades', 'rv-options', 'rv-input-wrap', 'rv-show']) $(id).hidden = true;
  $('rv-result').replaceChildren(); $('rv-back').replaceChildren(); $('rv-actions').replaceChildren(); $('rv-grades').replaceChildren();
  if (ex.type === 'choice' || ex.type === 'situation') {
    $('rv-options').replaceChildren(...shuffled(ex.options).map((o) => el('button', { type: 'button', class: 'opt', onclick: (e) => answerChoice(o, e.currentTarget) }, o)));
    $('rv-options').hidden = false;
  } else if (ex.type === 'cloze') {
    $('rv-input').value = ''; $('rv-input').disabled = false; $('rv-check').disabled = false;
    $('rv-input-wrap').hidden = false;
    $('rv-input').focus();
  } else {
    $('rv-show').hidden = false;
  }
}

/** 정답·해설·원래 항목을 보여 줌 */
function showBack() {
  const { ex, lesson, card } = session.cur;
  const it = lessonItems(lesson, { includeHidden: true }).find((x) => x.ref === card.ref);
  const nodes = [el('div', { class: 'answer' }, ex.type === 'meaning' ? ex.answer : `정답: ${ex.answer}`)];
  if (ex.explanationKo) nodes.push(el('div', { class: 'tip pre' }, `💡 ${ex.explanationKo}`));
  if (it?.kind === 'cor') nodes.push(el('div', { class: 'ctx' }, el('div', { class: 'bad' }, `❌ ${it.item.original}`), el('div', { class: 'good' }, `✅ ${it.item.corrected}`)));
  if (it?.kind === 'up') nodes.push(el('div', { class: 'ctx' }, el('div', { class: 'tip' }, `내가 한 말: ${it.item.original}`), el('div', { class: 'good' }, `→ ${it.item.suggestion}`)));
  if (it?.kind === 'exp' && ex.type !== 'meaning' && (it.sub || it.item.text !== ex.answer)) nodes.push(el('div', { class: 'ctx good' }, it.item.text, it.sub ? el('div', { class: 'tip' }, it.sub) : null));
  $('rv-back').replaceChildren(...nodes);
  $('rv-back').hidden = false;
}

function showGrades(grades) {
  const pv = previewIntervals(session.cur.card.srs, session.today);
  $('rv-grades').className = `grades g${grades.length}`;
  $('rv-grades').replaceChildren(...GRADES.filter((g) => grades.includes(g.grade)).map(({ grade, label }) =>
    el('button', { type: 'button', onclick: () => grade_(grade, grade > 1) }, label, el('small', {}, grade === 1 ? '오늘 다시' : `${pv[grade]}일 후`))));
  $('rv-grades').hidden = false;
}

function autoResult(correct, note = '') {
  $('rv-result').replaceChildren(el('div', { class: correct ? 'good score' : 'bad score' }, correct ? '정답!' : '틀렸어요', note ? el('span', { class: 'tip' }, ` ${note}`) : null));
  $('rv-result').hidden = false;
  showBack();
  if (correct) { $('rv-actions').hidden = true; showGrades([3, 4, 5]); return; }
  const acts = [];
  if (session.cur.ex.type === 'cloze') acts.push(el('button', { type: 'button', onclick: () => autoResult(true, '(정답으로 인정)') }, '정답으로 인정'));
  acts.push(el('button', { type: 'button', class: 'primary', onclick: () => grade_(1, false) }, '다음'));
  $('rv-actions').replaceChildren(...acts);
  $('rv-actions').hidden = false;
  $('rv-grades').hidden = true;
}

function answerChoice(opt, btn) {
  const { ex } = session.cur;
  const buttons = [...$('rv-options').children];
  if (buttons.some((b) => b.disabled)) return;
  for (const b of buttons) { b.disabled = true; if (b.textContent === ex.answer) b.classList.add('ok'); }
  const correct = opt === ex.answer;
  if (!correct) btn.classList.add('ng');
  autoResult(correct);
}

$('rv-check').addEventListener('click', () => {
  const { ex } = session.cur;
  const typed = $('rv-input').value;
  if (!typed.trim()) return;
  $('rv-input').disabled = true; $('rv-check').disabled = true;
  const r = checkTyped(ex, typed);
  autoResult(r.correct || r.close, r.close ? '(철자를 다시 확인하세요)' : r.correct ? '' : `내 답: ${typed.trim()}`);
});
$('rv-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('rv-check').disabled) $('rv-check').click(); });
$('rv-show').addEventListener('click', () => { $('rv-show').hidden = true; showBack(); showGrades([1, 3, 4, 5]); });

async function grade_(grade, correct) {
  const s = session;
  if (!s?.cur) return;
  const { card: c, ex } = s.cur;
  s.cur = null;
  const now = new Date().toISOString();
  const upd = { ...c, srs: review(c.srs, grade, s.today), log: [...(c.log || []), { at: now, grade, type: ex.type, correct, mode: s.mode }] };
  if (!correct) upd.wrong = { since: c.wrong?.since || now, lastType: ex.type };
  else if (s.mode === 'wrong') delete upd.wrong;
  await putCards([upd]);
  s.queue[s.i] = upd;
  s.done += 1;
  if (correct) s.right += 1; else s.wrong += 1;
  if (!correct && !s.requeued.has(c.id)) { s.requeued.add(c.id); s.avoid.set(c.id, ex.type); s.queue.push(upd); }
  s.i += 1;
  renderCard();
}

// ---------- 설정: 학습 기록 ----------
async function renderSettings() {
  const last = await getMeta('lastProgressExportAt', null);
  $('pg-last').textContent = last ? `마지막 내보내기: ${last.slice(0, 10)}` : '아직 내보낸 적이 없습니다.';
  const installed = matchMedia('(display-mode: standalone)').matches;
  const offline = !!navigator.serviceWorker?.controller;
  $('app-info').textContent = `버전 ${APP_VERSION} (데이터 형식 v${CURRENT_SCHEMA}) · ${installed ? '홈 화면 앱' : '브라우저'} · 오프라인 사용 ${offline ? '준비됨' : '준비 안 됨(https 배포 후 한 번 접속 필요)'}`;
  const s = await storageInfo();
  $('storage2').textContent = s.usage !== null ? `저장 공간 사용 ${fmtMB(s.usage)} / 허용 ${fmtMB(s.quota)}${s.persisted ? ' · 자동 정리 보호됨' : ''}` : '';
}

$('pg-export').addEventListener('click', async () => {
  const data = exportProgress(await listCards(), { appVersion: APP_VERSION });
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `english-review-progress-${ymd()}.json`);
  await setMeta('lastProgressExportAt', data.exportedAt);
  $('pg-msg').textContent = `카드 ${data.cards.length}장의 기록을 내보냈습니다. 다운로드 폴더를 확인하세요.`;
  renderSettings();
});

$('pg-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  const msg = $('pg-msg');
  if (!f) return;
  try {
    if (f.size > MAX_PROGRESS_BYTES) throw new Error('파일이 너무 큽니다.');
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { throw new Error('JSON 파일을 읽지 못했습니다.'); }
    const { cards, skipped, exportedAt } = parseProgress(obj);
    const { upserts, added, updated } = mergeProgress(await listCards(), cards);
    await putCards(upserts);
    for (const l of (await liveLessons()).values()) await syncCards(l);
    msg.textContent = `가져왔습니다(${String(exportedAt || '').slice(0, 10)} 기록): 새 카드 ${added}장, 기록 합침 ${updated}장${skipped ? `, 형식 오류로 건너뜀 ${skipped}장` : ''}. 아직 가져오지 않은 수업의 기록은 그 수업 패키지를 가져오면 나타납니다.`;
  } catch (err) {
    msg.textContent = err?.message || '가져오지 못했습니다.';
  } finally { e.target.value = ''; }
});

$('anki-export').addEventListener('click', async () => {
  const lessons = [...(await liveLessons()).values()];
  download(new Blob([toAnkiTsv(lessons)], { type: 'text/tab-separated-values;charset=utf-8' }), `english-review-anki-${ymd()}.tsv`);
});

// ---------- 오프라인(서비스 워커)·업데이트 ----------
let swReg = null;
function watchWorker(reg) {
  const showIfWaiting = () => { if (reg.waiting && navigator.serviceWorker.controller) $('upd-banner').hidden = false; };
  showIfWaiting();
  reg.addEventListener('updatefound', () => { reg.installing?.addEventListener('statechange', showIfWaiting); });
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then((reg) => { swReg = reg; watchWorker(reg); }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}
$('upd-apply').addEventListener('click', () => swReg?.waiting?.postMessage('SKIP_WAITING'));
$('upd-check').addEventListener('click', async () => {
  if (!swReg) { $('app-info').textContent += ' · 업데이트 확인은 https 배포 환경에서만 됩니다.'; return; }
  await swReg.update().catch(() => {});
  if (!swReg.waiting && !swReg.installing) $('app-info').textContent = `버전 ${APP_VERSION} · 최신 버전입니다.`;
});

// ---------- 시작: 구버전 데이터 변환 → 카드 동기화 ----------
async function upgradeData() {
  const today = localDate();
  for (const l of await listLessons()) {
    if ((l.schemaVersion ?? 1) < CURRENT_SCHEMA) await putLesson(migrate('lesson', l));
  }
  const legacy = (await listCards()).filter((c) => !c.lessonId && c.source);
  if (legacy.length) {
    const { cards, removeIds } = migrateLegacyCards(legacy, today);
    await putCards(cards);
    await deleteCards(removeIds);
  }
  for (const l of (await listLessons()).filter((x) => !x.deletedAt)) await syncCards(l);
}

initPlayer(el);
(async () => {
  try { await upgradeData(); } catch (err) { console.error('upgrade failed', err?.name); }
  show('review');
})();
