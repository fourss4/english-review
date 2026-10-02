// 화면 로직. 사용자 데이터는 모두 textContent로만 출력(innerHTML 미사용, XSS 방지)
import { buildLesson, parseFileName, validateLesson } from './parser/langdy-v1.js';
import { saveLesson, putLesson, listLessons, getAudio, purgeLesson, storageInfo, putCards, listCards, cardsByLesson, getMeta, setMeta } from './db.js';
import { syncLessonCards, toAnkiTsv } from './cards.js';
import { GRADES, review, previewIntervals, buildQueue, localDate, isNew } from './srs.js';
import { wordDiff } from './text.js';
import { initPlayer, loadPlayer, unloadPlayer } from './player.js';
import { searchLessons, splitByRanges } from './search.js';
import { createBackup, readBackup, BackupError } from './backup.js';
import { APP_VERSION } from './version.js';
import { listAllBookmarks, restoreLessonBundle } from './db.js';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200MB (20분 녹음 ≈ 10MB)
const MAX_AUDIO_SEC = 3 * 60 * 60;
const MAX_TEXT_CHARS = 100_000;

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

// ---------- 화면 전환 ----------
let currentAudioUrl = null;
function show(view) {
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== `view-${view}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === view);
  if (view !== 'detail') {
    unloadPlayer();
    $('d-audio').pause();
    if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; $('d-audio').removeAttribute('src'); }
  }
  if (view === 'list') renderList();
  if (view === 'review') { renderReviewHome(); renderReminder(); }
  if (view === 'settings') renderSettings();
  if (view === 'trash') renderTrash();
}
for (const t of document.querySelectorAll('.tab, .go')) t.addEventListener('click', () => show(t.dataset.view));
$('back').addEventListener('click', () => show('list'));

// ---------- 목록 ----------
const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)}MB`;
function lessonLabel(l) { return l.title || l.id; }
function lessonMeta(l) {
  return [l.date?.slice(0, 10), l.course && `${l.course}${l.lessonNo !== undefined ? ` #${l.lessonNo}` : ''}`,
    `표현 ${l.expressions.length} · 교정 ${l.corrections.length}`].filter(Boolean).join(' · ');
}

async function renderList() {
  const all = (await listLessons()).filter((l) => !l.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const ul = $('lessons');
  ul.replaceChildren(...all.map((l) => el('li', { class: 'card' },
    el('h3', {}, lessonLabel(l)), el('div', { class: 'muted' }, lessonMeta(l)),
    el('button', { type: 'button', onclick: () => openDetail(l) }, '열기'))));
  $('empty').hidden = all.length > 0;
  const s = await storageInfo();
  $('storage').textContent = s.usage !== null
    ? `저장 공간 사용 ${fmtMB(s.usage)} / 허용 ${fmtMB(s.quota)}${s.persisted ? ' · 자동 정리 보호됨' : ''}` : '';
  if ($('q').value.trim()) runSearch();
}

// ---------- 검색 ----------
let searchTimer = null;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});

async function runSearch() {
  const q = $('q').value;
  const box = $('q-results');
  const active = q.trim().length >= 2;
  box.hidden = !active; $('lessons').hidden = active; $('empty').hidden = active || $('lessons').children.length > 0;
  if (!active) return;
  const res = searchLessons(await listLessons(), q);
  if (!res.length) { box.replaceChildren(el('p', { class: 'muted' }, '검색 결과가 없습니다.')); return; }
  box.replaceChildren(...res.map(({ lesson, hits }) => el('div', { class: 'card' },
    el('h3', {}, lessonLabel(lesson)), el('div', { class: 'muted' }, lesson.date.slice(0, 10)),
    ...hits.slice(0, 8).map((h) => el('div', { class: 'hit' }, el('small', {}, h.label),
      ...splitByRanges(h.text, h.ranges).map((p) => (p.hit ? el('mark', {}, p.text) : p.text)))),
    hits.length > 8 ? el('div', { class: 'muted' }, `외 ${hits.length - 8}건`) : null,
    el('button', { type: 'button', onclick: () => openDetail(lesson) }, '수업 열기'))));
}

// ---------- 상세 ----------
function exampleLines(ex = []) { return ex.map((e) => (e.speaker ? `${e.speaker}. ${e.en}` : e.en)); }

async function openDetail(l) {
  show('detail');
  $('d-title').textContent = lessonLabel(l);
  $('d-meta').textContent = lessonMeta(l);
  const a = await getAudio(l.id);
  const audio = $('d-audio');
  audio.hidden = !a;
  if (a) { currentAudioUrl = URL.createObjectURL(a.blob); audio.src = currentAudioUrl; }
  await loadPlayer(l, !!a);
  const rawChat = l.source?.raw?.chat || '';
  $('d-chat-wrap').hidden = !rawChat.trim(); $('d-chat-wrap').open = false;
  $('d-chat').textContent = rawChat;

  const body = [];
  if (l.feedback?.summary) body.push(el('div', { class: 'item' }, el('h4', {}, '강사 총평'), el('p', {}, l.feedback.summary)));
  for (const e of l.expressions) {
    body.push(el('div', { class: 'item' },
      el('h4', {}, e.isKey ? '핵심 표현' : '표현'),
      el('strong', {}, e.text), e.pattern ? el('div', { class: 'tip' }, `패턴: ${e.pattern}`) : null,
      e.definition ? el('div', {}, `${e.partOfSpeech ? `(${e.partOfSpeech}) ` : ''}${e.definition}`) : null,
      e.meaning ? el('div', {}, e.meaning) : null,
      ...exampleLines(e.examples).map((t) => el('div', { class: 'tip' }, t))));
  }
  l.corrections.forEach((c, i) => {
    body.push(el('div', { class: 'item' },
      el('h4', {}, `교정 ${i + 1}`),
      el('div', { class: 'bad' }, `❌ ${c.original}`),
      el('div', { class: 'good' }, `✅ ${c.corrected}`),
      c.explanation ? el('div', { class: 'tip' }, `💡 ${c.explanation}`) : null,
      c.natural ? el('div', { class: 'good' }, `✨ ${c.natural}`) : null,
      c.explanationLong ? el('div', { class: 'tip' }, c.explanationLong) : null));
  });
  $('d-body').replaceChildren(...body);
  $('d-review').onclick = () => startSession({ lessonId: l.id });
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
      if (confirm('영구 삭제하면 되돌릴 수 없습니다. 삭제할까요?')) { await purgeLesson(l.id); renderTrash(); }
    } }, '영구 삭제'))) : [el('li', { class: 'muted' }, '비어 있음')]));
}

// ---------- 가져오기 ----------
let audioFile = null;
let audioProbe = null;
let draft = null;

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
  const dateStr = $('f-date').value || parseFileName(audioFile?.name || '').date || new Date().toISOString().slice(0, 10);
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
  renderPreview(report);
});

function field(label, value, onInput, { multiline = false, type = 'text' } = {}) {
  const input = multiline ? el('textarea', { rows: 3 }) : el('input', { type });
  input.value = value ?? '';
  input.addEventListener('input', () => onInput(input.value));
  return el('label', {}, label, input);
}

function examplesField(e) {
  return field('예문 (한 줄에 하나, 대화는 "A. 문장")', exampleLines(e.examples).join('\n'), (v) => {
    const ex = v.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([A-Z])\.\s+(.+)$/);
      return m ? { speaker: m[1], en: m[2] } : { en: s };
    });
    if (ex.length) e.examples = ex; else delete e.examples;
  }, { multiline: true });
}

function setOpt(obj, key, v) { if (v.trim()) obj[key] = v; else delete obj[key]; }

function renderPreview(report) {
  const r = [];
  if (report.warnings.length) r.push(el('div', { class: 'warn' }, '확인 필요: ', report.warnings.join(' / ')));
  if (report.unmatchedCommentParagraphs.length) r.push(el('div', { class: 'warn' }, `코멘트 문단 ${report.unmatchedCommentParagraphs.length}개를 자동 분류하지 못했습니다. 원문은 보존됩니다.`));
  if (report.ignoredChatLines.length) r.push(el('div', { class: 'muted' }, '채팅에서 제외한 줄(인사말 등): ', report.ignoredChatLines.join(' / ')));
  if (report.suspiciousWords.length) {
    r.push(el('div', { class: 'warn' }, '코멘트에 글자 인식(OCR) 오류로 보이는 단어가 있습니다. 교정 문장은 채팅 기준으로 사용했고, 해설·총평은 아래 단어를 확인해 고쳐 주세요.',
      el('div', { class: 'chips' }, ...report.suspiciousWords.map((w) => el('span', { class: 'chip' }, w)))));
  }
  $('report').replaceChildren(...r);

  const d = draft;
  const f = [
    field('과정명', d.course, (v) => setOpt(d, 'course', v)),
    field('회차', d.lessonNo, (v) => { if (v === '') delete d.lessonNo; else d.lessonNo = Math.max(0, parseInt(v, 10) || 0); }, { type: 'number' }),
    field('수업 제목', d.title, (v) => setOpt(d, 'title', v)),
  ];
  if (d.feedback) f.push(field('강사 총평', d.feedback.summary, (v) => { d.feedback.summary = v; }, { multiline: true }));

  d.expressions.forEach((e, i) => {
    f.push(el('div', { class: 'item' },
      el('h4', {}, e.isKey ? '핵심 표현' : `표현 ${i + 1}`),
      field('표현', e.text, (v) => { e.text = v; }),
      e.isKey ? field('패턴', e.pattern, (v) => setOpt(e, 'pattern', v)) : null,
      !e.isKey ? field('품사', e.partOfSpeech, (v) => setOpt(e, 'partOfSpeech', v)) : null,
      !e.isKey ? field('영문 정의', e.definition, (v) => setOpt(e, 'definition', v)) : null,
      examplesField(e),
      el('button', { type: 'button', onclick: () => { d.expressions.splice(i, 1); renderPreview(report); } }, '이 항목 빼기')));
  });
  d.corrections.forEach((c, i) => {
    f.push(el('div', { class: 'item' },
      el('h4', {}, `교정 ${i + 1}`),
      field('❌ 틀린 문장', c.original, (v) => { c.original = v; }, { multiline: true }),
      field('✅ 교정', c.corrected, (v) => { c.corrected = v; }, { multiline: true }),
      field('💡 이유', c.explanation, (v) => setOpt(c, 'explanation', v), { multiline: true }),
      field('✨ 더 자연스러운 표현', c.natural, (v) => setOpt(c, 'natural', v), { multiline: true }),
      c.explanationLong !== undefined ? field('코멘트 해설', c.explanationLong, (v) => setOpt(c, 'explanationLong', v), { multiline: true }) : null,
      el('button', { type: 'button', onclick: () => { d.corrections.splice(i, 1); renderPreview(report); } }, '이 항목 빼기')));
  });
  $('pv-fields').replaceChildren(...f);
  $('preview').hidden = false;
  $('import-form').hidden = true;
}

function resetImport() {
  draft = null; audioFile = null; audioProbe = null;
  $('import-form').reset(); $('f-audio-info').textContent = '';
  $('preview').hidden = true; $('import-form').hidden = false;
}

$('pv-cancel').addEventListener('click', () => { $('preview').hidden = true; $('import-form').hidden = false; });
$('pv-save').addEventListener('click', async () => {
  const msg = $('import-msg');
  const d = draft;
  d.expressions = d.expressions.filter((e) => e.text?.trim());
  d.expressions.forEach((e, i) => { e.id = `exp_${String(i + 1).padStart(2, '0')}`; });
  d.corrections.forEach((c, i) => { c.id = `cor_${String(i + 1).padStart(2, '0')}`; });
  const errs = validateLesson(d);
  if (errs.length) { msg.textContent = `저장할 수 없습니다. 비어 있는 항목: ${errs.join(', ')}`; return; }
  try {
    await saveLesson(d, audioFile);
    await syncCards(d);
    msg.textContent = '저장했습니다.';
    resetImport();
    show('list');
  } catch (err) {
    console.error('save failed', err?.name, err?.message);
    msg.textContent = err?.name === 'QuotaExceededError' ? '저장 공간이 부족합니다.' : '저장 중 오류가 발생했습니다.';
  }
});

// ---------- 카드 동기화 ----------
async function syncCards(lesson) {
  const { upserts, suspends } = syncLessonCards(lesson, await cardsByLesson(lesson.id), localDate());
  await putCards([...upserts, ...suspends]);
}

// ---------- 복습 ----------
const KIND = { en2ko: '뜻 떠올리기', ko2en: '영어로 말하기', en2def: '뜻·쓰임 떠올리기', cloze: '빈칸 채우기', fix: '문장 고치기' };
const TYPED = new Set(['cloze', 'fix']);
let session = null;

async function activeCards() {
  const lessons = await listLessons();
  const live = new Set(lessons.filter((l) => !l.deletedAt).map((l) => l.id));
  return (await listCards()).filter((c) => live.has(c.source.lessonId));
}

async function newLimitLeft(cards, today) {
  const limit = await getMeta('newPerDay', 20);
  const studiedToday = cards.filter((c) => c.log?.length && c.log[0].at.slice(0, 10) === today).length;
  return { limit, left: Math.max(0, limit - studiedToday) };
}

async function renderReviewHome() {
  $('rv-home').hidden = false; $('rv-session').hidden = true; $('rv-done').hidden = true;
  const today = localDate();
  const cards = await activeCards();
  const { limit, left } = await newLimitLeft(cards, today);
  const q = buildQueue(cards, today, { newLimit: left });
  $('rv-due').textContent = q.filter((c) => !isNew(c)).length;
  $('rv-new').textContent = q.filter(isNew).length;
  $('rv-total').textContent = cards.filter((c) => !c.suspended).length;
  $('rv-newlimit').value = limit;
  $('rv-start').disabled = q.length === 0;
  const noKo = cards.some((c) => c.direction === 'en2def');
  $('rv-note').textContent = !cards.length ? '수업을 가져오면 카드가 자동으로 만들어집니다.'
    : q.length === 0 ? '오늘 복습할 카드가 없습니다.'
    : noKo ? '한국어 뜻이 없는 표현은 "뜻·쓰임 떠올리기" 카드로 나옵니다. AI 단계에서 한국어 뜻을 채우면 영↔한 카드가 추가됩니다.' : '';
}

$('rv-newlimit').addEventListener('change', async (e) => {
  const v = Math.min(200, Math.max(0, parseInt(e.target.value, 10) || 0));
  await setMeta('newPerDay', v); renderReviewHome();
});

$('rv-export').addEventListener('click', async () => {
  const cards = (await activeCards()).filter((c) => !c.suspended);
  const blob = new Blob([toAnkiTsv(cards)], { type: 'text/tab-separated-values;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `cards-anki-${localDate()}.tsv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('rv-start').addEventListener('click', () => startSession({}));
$('rv-quit').addEventListener('click', () => endSession());
$('rv-done-home').addEventListener('click', () => renderReviewHome());

async function startSession({ lessonId } = {}) {
  const today = localDate();
  let queue;
  if (lessonId) {
    queue = (await cardsByLesson(lessonId)).filter((c) => !c.suspended);
  } else {
    const cards = await activeCards();
    queue = buildQueue(cards, today, { newLimit: (await newLimitLeft(cards, today)).left });
  }
  if (!queue.length) { show('review'); return; }
  session = { queue, i: 0, today, done: 0, again: 0 };
  show('review');
  $('rv-home').hidden = true; $('rv-done').hidden = true; $('rv-session').hidden = false;
  renderCard();
}

function endSession() {
  if (!session) return renderReviewHome();
  $('rv-session').hidden = true; $('rv-home').hidden = true; $('rv-done').hidden = false;
  $('rv-done-msg').textContent = `${session.done}장 복습했습니다${session.again ? ` (다시 본 카드 ${session.again}장)` : ''}.`;
  session = null;
}

function renderCard() {
  const c = session.queue[session.i];
  $('rv-progress').textContent = `${session.i + 1} / ${session.queue.length}`;
  $('rv-kind').textContent = KIND[c.direction] || c.direction;
  $('rv-front').textContent = c.direction === 'fix' ? `❌ ${c.front}` : c.front;
  $('rv-back').textContent = c.back; $('rv-back').hidden = true;
  $('rv-result').replaceChildren(); $('rv-result').hidden = true;
  $('rv-grades').hidden = true;
  const typed = TYPED.has(c.direction);
  $('rv-input-wrap').hidden = !typed; $('rv-show').hidden = typed;
  $('rv-input').value = '';
  $('rv-input').placeholder = c.direction === 'fix' ? '고친 문장을 입력하세요' : '빈칸에 들어갈 표현';
  if (typed) $('rv-input').focus();
}

function reveal() {
  const c = session.queue[session.i];
  $('rv-back').hidden = false; $('rv-show').hidden = true; $('rv-input-wrap').hidden = true;
  const pv = previewIntervals(c.srs, session.today);
  $('rv-grades').replaceChildren(...GRADES.map(({ grade, label }) => el('button', { type: 'button', onclick: () => grade_(grade) },
    label, el('small', {}, grade < 3 ? '다시 보기' : `${pv[grade]}일 후`))));
  $('rv-grades').hidden = false;
}

$('rv-show').addEventListener('click', reveal);
$('rv-check').addEventListener('click', () => {
  const c = session.queue[session.i];
  const typed = $('rv-input').value;
  const cands = [c.answer, c.altAnswer].filter(Boolean);
  const best = cands.map((a) => ({ a, ...wordDiff(a, typed) })).sort((x, y) => y.score - x.score)[0];
  const pct = Math.round(best.score * 100);
  $('rv-result').replaceChildren(
    el('div', { class: 'score' }, `일치 ${pct}%`, best.a === c.altAnswer ? ' (더 자연스러운 표현 기준)' : ''),
    el('div', { class: 'muted' }, '밑줄 = 빠진 단어, 취소선 = 불필요한 단어'),
    el('div', { class: 'diff' }, ...best.ops.flatMap((o) => [el('span', { class: o.type === 'same' ? '' : o.type === 'del' ? 'miss' : 'extra' }, o.text), ' '])));
  $('rv-result').hidden = false;
  reveal();
});

async function grade_(grade) {
  const c = session.queue[session.i];
  const updated = { ...c, srs: review(c.srs, grade, session.today), log: [...(c.log || []), { at: new Date().toISOString(), grade }] };
  await putCards([updated]);
  session.queue[session.i] = updated;
  session.done += 1;
  if (grade < 3) { session.queue.push(updated); session.again += 1; }
  session.i += 1;
  if (session.i >= session.queue.length) endSession(); else renderCard();
}

// ---------- 백업·복원 ----------
const BACKUP_REMIND_DAYS = 14;
const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

async function renderReminder() {
  const lessons = (await listLessons()).filter((l) => !l.deletedAt);
  const last = await getMeta('lastBackupAt', null);
  const due = lessons.length > 0 && (!last || daysSince(last) >= BACKUP_REMIND_DAYS);
  $('bk-remind').hidden = !due;
  if (due) $('bk-remind-text').textContent = last ? `마지막 백업이 ${daysSince(last)}일 전입니다. ` : '아직 백업한 적이 없습니다. ';
}
$('bk-remind-go').addEventListener('click', () => show('settings'));

async function renderSettings() {
  const last = await getMeta('lastBackupAt', null);
  $('bk-last').textContent = last ? `마지막 백업: ${last.slice(0, 10)} (${daysSince(last)}일 전)` : '아직 백업한 적이 없습니다.';
  const installed = matchMedia('(display-mode: standalone)').matches;
  const offline = !!navigator.serviceWorker?.controller;
  $('app-info').textContent = `버전 ${APP_VERSION} · ${installed ? '홈 화면 앱' : '브라우저'} · 오프라인 사용 ${offline ? '준비됨' : '준비 안 됨(https 배포 후 한 번 접속 필요)'}`;
  const s = await storageInfo();
  $('storage2').textContent = s.usage !== null ? `저장 공간 사용 ${fmtMB(s.usage)} / 허용 ${fmtMB(s.quota)}${s.persisted ? ' · 자동 정리 보호됨' : ''}` : '';
}

$('bk-export').addEventListener('click', async () => {
  const btn = $('bk-export'), msg = $('bk-msg');
  btn.disabled = true; msg.textContent = '백업 파일을 만드는 중…';
  try {
    const lessons = await listLessons();
    const audios = new Map();
    if ($('bk-audio').checked) for (const l of lessons) { const a = await getAudio(l.id); if (a) audios.set(l.id, a); }
    const { blob, manifest } = await createBackup({
      lessons, audios, cards: await listCards(), bookmarks: await listAllBookmarks(),
      includeAudio: $('bk-audio').checked, appVersion: APP_VERSION,
    });
    const a = el('a', { href: URL.createObjectURL(blob), download: `english-review-backup-${stamp()}.zip` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    await setMeta('lastBackupAt', manifest.createdAt);
    msg.textContent = `백업 완료: 수업 ${manifest.counts.lessons}개, 카드 ${manifest.counts.cards}장, 녹음 ${manifest.counts.audio}개 · ${fmtMB(blob.size)}. 다운로드 폴더를 확인하세요.`;
    renderSettings();
  } catch (err) {
    msg.textContent = err?.message?.includes('4GB') ? err.message : '백업을 만들지 못했습니다. 저장 공간을 확인해 주세요.';
  } finally { btn.disabled = false; }
});

let pendingRestore = null;
$('rs-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  pendingRestore = null; $('rs-preview').hidden = true; $('rs-msg').textContent = '';
  if (!f) return;
  $('rs-msg').textContent = '백업 파일 확인 중…';
  try {
    const data = await readBackup(f);
    const existing = new Set((await listLessons()).map((l) => l.id));
    const conflicts = data.lessons.filter((l) => existing.has(l.id)).length;
    pendingRestore = data;
    const m = data.manifest;
    $('rs-summary').replaceChildren(...[
      el('p', {}, `만든 날짜 ${String(m.createdAt).slice(0, 10)} · 앱 버전 ${m.appVersion || '-'}`),
      el('p', {}, `수업 ${data.lessons.length}개 · 카드 ${data.cards.length}장 · 구간 ${data.bookmarks.length}개 · 녹음 ${data.audios.size}개`),
      conflicts ? el('p', { class: 'warn' }, `기기에 이미 있는 수업 ${conflicts}개`) : null,
      data.warnings.length ? el('div', { class: 'warn' }, '참고: ', data.warnings.slice(0, 5).join(' / ')) : null].filter(Boolean));
    $('rs-policy').hidden = conflicts === 0;
    $('rs-preview').hidden = false;
    $('rs-msg').textContent = '확인 완료. 파일이 손상되지 않았습니다.';
  } catch (err) {
    $('rs-msg').textContent = err instanceof BackupError ? `복원할 수 없습니다: ${err.message}` : '백업 파일을 읽지 못했습니다.';
  }
});

$('rs-apply').addEventListener('click', async () => {
  if (!pendingRestore) return;
  const policy = document.querySelector('input[name="rs-policy"]:checked')?.value || 'skip';
  const { lessons, audios, cards, bookmarks } = pendingRestore;
  const existing = new Set((await listLessons()).map((l) => l.id));
  let restored = 0, skipped = 0;
  $('rs-apply').disabled = true;
  try {
    for (const l of lessons) {
      if (existing.has(l.id) && policy === 'skip') { skipped++; continue; }
      await restoreLessonBundle(l, audios.get(l.id), cards.filter((c) => c.source.lessonId === l.id), bookmarks.filter((b) => b.lessonId === l.id));
      if (!l.deletedAt) await syncCards(l);
      restored++;
    }
    $('rs-msg').textContent = `복원 완료: ${restored}개${skipped ? `, 건너뜀 ${skipped}개` : ''}.`;
    pendingRestore = null; $('rs-preview').hidden = true; $('rs-file').value = '';
  } catch (err) {
    $('rs-msg').textContent = err?.name === 'QuotaExceededError' ? `저장 공간이 부족합니다. ${restored}개까지 복원했습니다.` : `복원 중 오류가 발생했습니다. ${restored}개까지 복원했습니다.`;
  } finally { $('rs-apply').disabled = false; }
});

// ---------- 오프라인(서비스 워커)·업데이트 ----------
let swReg = null;
function watchWorker(reg) {
  const showIfWaiting = () => { if (reg.waiting && navigator.serviceWorker.controller) $('upd-banner').hidden = false; };
  showIfWaiting();
  reg.addEventListener('updatefound', () => {
    reg.installing?.addEventListener('statechange', showIfWaiting);
  });
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

// ---------- 시작 ----------
initPlayer(el);
(async () => {
  try {
    for (const l of (await listLessons()).filter((x) => !x.deletedAt)) await syncCards(l);
  } catch { /* 카드 동기화 실패 시에도 앱은 계속 동작 */ }
  show('review');
})();

