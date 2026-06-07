'use strict';

/* ————— state ————— */

const KEY = 'punchcard.v1';
const PALETTE = ['#C9821E', '#6E8F3C', '#3D7CA6', '#B25B5B', '#7C5BA6', '#2F8C72', '#A65A2A', '#94821F'];

let state = load() || { seq: 1, projects: [], activities: [], sessions: [] };
let view = { tab: 'today', calY: null, calM: null, selKey: null };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function uid() { return state.seq++; }

/* ————— helpers ————— */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');

function clock(sec) { // 1:04:09
  sec = Math.floor(sec);
  return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
}
function fmtDur(sec) { // 2h 04m · 14m · 32s · —
  sec = Math.floor(sec);
  if (sec <= 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(sec % 60)}s`;
  return `${sec}s`;
}
function fmtHM(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return keyOf(new Date()); }
function dateOfKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function rangeOfKey(k) {
  const d = dateOfKey(k);
  return [d.getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()];
}
function fmtDayTitle(k) {
  return dateOfKey(k).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* ————— domain ————— */

const getProject  = id => state.projects.find(p => p.id === id);
const getActivity = id => state.activities.find(a => a.id === id);
const runningSession = () => state.sessions.find(s => !s.end);
const isRunning = id => { const r = runningSession(); return !!r && r.activityId === id; };

function overlapSec(s, t0, t1) {
  const end = s.end ?? Date.now();
  return Math.max(0, Math.min(end, t1) - Math.max(s.start, t0)) / 1000;
}
function actSecs(actId, t0, t1) {
  return state.sessions.reduce((t, s) => s.activityId === actId ? t + overlapSec(s, t0, t1) : t, 0);
}
function projSecs(projId, t0, t1) {
  return state.activities.reduce((t, a) => a.projectId === projId ? t + actSecs(a.id, t0, t1) : t, 0);
}
function totalSecs(t0, t1) {
  return state.sessions.reduce((t, s) => t + overlapSec(s, t0, t1), 0);
}

/* ————— mutations ————— */

function addProject(name) {
  state.projects.push({ id: uid(), name, color: PALETTE[state.projects.length % PALETTE.length] });
  commit();
}
function addActivity(projectId, description) {
  state.activities.push({ id: uid(), projectId, description, done: false });
  commit();
}
function pauseRunning() {
  const s = runningSession();
  if (s) s.end = Date.now();
}
function startActivity(id) {
  pauseRunning(); // context switch: starting one pauses whatever was running
  const a = getActivity(id);
  if (a) a.done = false;
  state.sessions.push({ id: uid(), activityId: id, start: Date.now(), end: null });
  commit();
}
function pauseActivity() { pauseRunning(); commit(); }
function finishActivity(id) {
  if (isRunning(id)) pauseRunning();
  const a = getActivity(id);
  if (a) a.done = !a.done;
  commit();
}
function deleteActivity(id) {
  const a = getActivity(id);
  if (!confirm(`Delete "${a.description}" and all its logged time?`)) return;
  state.sessions = state.sessions.filter(s => s.activityId !== id);
  state.activities = state.activities.filter(x => x.id !== id);
  commit();
}
function deleteProject(id) {
  const p = getProject(id);
  if (!confirm(`Delete project "${p.name}", its activities, and all logged time?`)) return;
  const actIds = new Set(state.activities.filter(a => a.projectId === id).map(a => a.id));
  state.sessions = state.sessions.filter(s => !actIds.has(s.activityId));
  state.activities = state.activities.filter(a => a.projectId !== id);
  state.projects = state.projects.filter(x => x.id !== id);
  commit();
}
function commit() { save(); render(); }

/* ————— CSV export ————— */

function exportCSV() {
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const fmtTS = ts => {
    const d = new Date(ts);
    return `${keyOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const rows = [['Date', 'Project', 'Activity', 'Start', 'End', 'Duration (sec)', 'Duration (h:mm:ss)']];
  for (const s of [...state.sessions].sort((a, b) => a.start - b.start)) {
    const a = getActivity(s.activityId);
    const p = a && getProject(a.projectId);
    const end = s.end ?? Date.now();
    const dur = Math.floor((end - s.start) / 1000);
    rows.push([
      keyOf(new Date(s.start)),
      p ? p.name : '?',
      a ? a.description : '?',
      fmtTS(s.start),
      s.end ? fmtTS(s.end) : '(running)',
      dur,
      clock(dur),
    ]);
  }
  const csv = rows.map(r => r.map(q).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM so Sheets/Excel read UTF-8
  const aEl = document.createElement('a');
  aEl.href = URL.createObjectURL(blob);
  aEl.download = `punchcard-${todayKey()}.csv`;
  aEl.click();
  URL.revokeObjectURL(aEl.href);
}

/* ————— rendering ————— */

const app = document.getElementById('app');

function render() {
  document.getElementById('header-date').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === view.tab));
  app.innerHTML = view.tab === 'today' ? todayHTML() : historyHTML();
}

/* — today tab — */

function todayHTML() {
  const [t0, t1] = rangeOfKey(todayKey());
  return `
    <section class="fade-in">${heroHTML(t0, t1)}</section>
    <div class="cols">
      <section class="fade-in">${projectsHTML(t0, t1)}</section>
      <aside class="panel fade-in" id="analytics">${analyticsHTML(t0, t1, "Today's ledger")}</aside>
    </div>`;
}

function heroHTML(t0, t1) {
  const run = runningSession();
  if (!run) {
    const total = totalSecs(t0, t1);
    return `
      <div class="hero">
        <div>
          <div class="hero-label">Off the clock</div>
          <h2 class="hero-act muted">Nothing running</h2>
          <div class="hero-sub">${total > 0 ? `${fmtDur(total)} logged today — press ▶ to punch back in` : 'press ▶ on an activity to punch in'}</div>
        </div>
        <div class="hero-right"><div class="hero-clock">0:00:00</div></div>
      </div>`;
  }
  const a = getActivity(run.activityId);
  const p = getProject(a.projectId);
  return `
    <div class="hero is-on">
      <div>
        <div class="hero-label"><span class="pulse"></span> On the clock</div>
        <h2 class="hero-act">${esc(a.description)}</h2>
        <span class="proj-chip" style="--c:${p.color}">${esc(p.name)}</span>
      </div>
      <div class="hero-right">
        <div class="hero-clock" data-hero-clock>${clock(actSecs(a.id, t0, t1))}</div>
        <div class="hero-btns">
          <button class="btn" data-action="pause">❚❚ Pause</button>
          <button class="btn btn-primary" data-action="finish" data-id="${a.id}">✓ Finish</button>
        </div>
      </div>
    </div>`;
}

function projectsHTML(t0, t1) {
  let html = state.projects.map(p => {
    const acts = state.activities.filter(a => a.projectId === p.id);
    const rows = acts.map(a => activityRowHTML(a, t0, t1)).join('') ||
      `<div class="empty">no activities yet — add one below</div>`;
    return `
      <div class="proj-card">
        <div class="proj-head" style="--c:${p.color}">
          <h3>${esc(p.name)}</h3>
          <span class="proj-total" data-proj-time="${p.id}">${fmtDur(projSecs(p.id, t0, t1))} today</span>
          <button class="icon-btn danger proj-del" data-action="del-project" data-id="${p.id}" title="Delete project">✕</button>
        </div>
        ${rows}
        <form class="add-form" data-form="add-activity" data-project="${p.id}">
          <input name="desc" placeholder="Add an activity…" autocomplete="off">
          <button class="btn" type="submit">+ Add</button>
        </form>
      </div>`;
  }).join('');

  if (!state.projects.length) {
    html = `<div class="proj-card"><div class="empty">A blank ledger. Add your first project — e.g. “my website” — then add activities under it.</div></div>`;
  }

  return html + `
    <form class="add-form add-project" data-form="add-project">
      <input name="name" placeholder="New project…" autocomplete="off">
      <button class="btn btn-primary" type="submit">+ Project</button>
    </form>`;
}

function activityRowHTML(a, t0, t1) {
  const running = isRunning(a.id);
  return `
    <div class="act ${running ? 'running' : ''} ${a.done ? 'done' : ''}">
      <span class="dot"></span>
      <span class="act-name" title="${esc(a.description)}">${esc(a.description)}</span>
      <span class="leader"></span>
      <span class="act-time" data-time-act="${a.id}">${fmtDur(actSecs(a.id, t0, t1))}</span>
      <span class="act-btns">
        ${running
          ? `<button class="icon-btn" data-action="pause" title="Pause">❚❚</button>`
          : `<button class="icon-btn play" data-action="start" data-id="${a.id}" title="${a.done ? 'Reopen & start' : 'Start'}">▶</button>`}
        <button class="icon-btn" data-action="finish" data-id="${a.id}" title="${a.done ? 'Mark not done' : 'Mark done'}">✓</button>
        <button class="icon-btn danger del" data-action="del-activity" data-id="${a.id}" title="Delete">✕</button>
      </span>
    </div>`;
}

/* — analytics (shared by today + history) — */

function analyticsHTML(t0, t1, title) {
  const total = totalSecs(t0, t1);
  if (total <= 0) return `<div class="panel-title">${title}</div><div class="empty">nothing logged</div>`;

  const projRows = state.projects
    .map(p => ({ p, s: projSecs(p.id, t0, t1) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  const actRows = state.activities
    .map(a => ({ a, s: actSecs(a.id, t0, t1) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 10);

  return `
    <div class="panel-title">${title}</div>
    <div class="big-total">${clock(total)}</div>
    <div class="big-total-sub">total time on the clock</div>
    <div class="stack-bar">
      ${projRows.map(({ p, s }) => `<i style="--c:${p.color}; width:${(s / total * 100).toFixed(2)}%" title="${esc(p.name)}"></i>`).join('')}
    </div>
    ${projRows.map(({ p, s }) => `
      <div class="ledger-row" style="--c:${p.color}">
        <span class="swatch"></span>
        <span class="lname">${esc(p.name)}</span>
        <span class="lpct">${Math.round(s / total * 100)}%</span>
        <span class="lval">${fmtDur(s)}</span>
      </div>`).join('')}
    <div class="subhead">Top activities</div>
    ${actRows.map(({ a, s }) => {
      const p = getProject(a.projectId);
      return `
        <div class="ledger-row" style="--c:${p ? p.color : '#888'}">
          <span class="swatch"></span>
          <span class="lname" title="${esc(a.description)}">${esc(a.description)}</span>
          <span class="lpct">${Math.round(s / total * 100)}%</span>
          <span class="lval">${fmtDur(s)}</span>
        </div>`;
    }).join('')}`;
}

/* — history tab — */

function historyHTML() {
  const now = new Date();
  if (view.calY === null) { view.calY = now.getFullYear(); view.calM = now.getMonth(); }
  if (!view.selKey) view.selKey = todayKey();
  return `
    <div class="hist-cols">
      <section class="fade-in">${calendarHTML()}</section>
      <section class="day-panel fade-in" id="day-panel">${dayDetailHTML(view.selKey)}</section>
    </div>`;
}

function calendarHTML() {
  const y = view.calY, m = view.calM;
  const first = new Date(y, m, 1);
  const startBlank = (first.getDay() + 6) % 7; // monday first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const tk = todayKey();

  let cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  cells += `<div class="cal-cell blank"></div>`.repeat(startBlank);

  for (let d = 1; d <= daysInMonth; d++) {
    const k = keyOf(new Date(y, m, d));
    const [t0, t1] = rangeOfKey(k);
    const secs = totalSecs(t0, t1);
    const heat = Math.min(1, secs / (8 * 3600)); // 8h = full heat
    cells += `
      <div class="cal-cell ${k === tk ? 'today' : ''} ${k === view.selKey ? 'sel' : ''}" data-action="sel-day" data-key="${k}">
        <span class="cd">${d}</span>
        ${secs > 0 ? `<span class="heat" style="opacity:${(0.25 + heat * 0.75).toFixed(2)}"></span><span class="ct">${fmtDur(secs)}</span>` : ''}
      </div>`;
  }

  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `
    <div class="cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-prev" title="Previous month">‹</button>
        <h3>${label}</h3>
        <button class="icon-btn" data-action="cal-next" title="Next month">›</button>
      </div>
      <div class="cal-grid">${cells}</div>
    </div>`;
}

function dayDetailHTML(k) {
  const [t0, t1] = rangeOfKey(k);
  const sessions = state.sessions
    .filter(s => overlapSec(s, t0, t1) > 0)
    .sort((a, b) => a.start - b.start);

  const log = sessions.map(s => {
    const a = getActivity(s.activityId);
    const p = a && getProject(a.projectId);
    const live = !s.end;
    return `
      <div class="sess ${live ? 'live' : ''}">
        <span class="stime">${fmtHM(Math.max(s.start, t0))} – ${live ? 'now' : fmtHM(Math.min(s.end, t1))}</span>
        <span class="sname">${a ? esc(a.description) : '?'}</span>
        <span class="sproj proj-chip" style="--c:${p ? p.color : '#888'}">${p ? esc(p.name) : ''}</span>
        <span class="sdur">${fmtDur(overlapSec(s, t0, t1))}</span>
      </div>`;
  }).join('') || `<div class="empty">no sessions this day</div>`;

  return `
    <h2 class="day-title">${fmtDayTitle(k)}</h2>
    ${analyticsHTML(t0, t1, 'Day ledger')}
    <div class="subhead" style="margin-top:24px">Session log</div>
    ${log}`;
}

/* ————— live ticking ————— */

function tick() {
  if (!runningSession()) return;
  const [t0, t1] = rangeOfKey(todayKey());

  if (view.tab === 'today') {
    const heroClock = document.querySelector('[data-hero-clock]');
    const run = runningSession();
    if (heroClock && run) heroClock.textContent = clock(actSecs(run.activityId, t0, t1));
    document.querySelectorAll('[data-time-act]').forEach(el => {
      el.textContent = fmtDur(actSecs(+el.dataset.timeAct, t0, t1));
    });
    document.querySelectorAll('[data-proj-time]').forEach(el => {
      el.textContent = `${fmtDur(projSecs(+el.dataset.projTime, t0, t1))} today`;
    });
    const an = document.getElementById('analytics');
    if (an) an.innerHTML = analyticsHTML(t0, t1, "Today's ledger");
  } else if (view.selKey === todayKey()) {
    const dp = document.getElementById('day-panel');
    if (dp) dp.innerHTML = dayDetailHTML(view.selKey);
  }
}
setInterval(tick, 1000);

/* ————— events ————— */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = +el.dataset.id;
  switch (el.dataset.action) {
    case 'tab':          view.tab = el.dataset.tab; render(); break;
    case 'start':        startActivity(id); break;
    case 'pause':        pauseActivity(); break;
    case 'finish':       finishActivity(id); break;
    case 'del-activity': deleteActivity(id); break;
    case 'del-project':  deleteProject(id); break;
    case 'export':       exportCSV(); break;
    case 'sel-day':      view.selKey = el.dataset.key; render(); break;
    case 'cal-prev':     view.calM--; if (view.calM < 0)  { view.calM = 11; view.calY--; } render(); break;
    case 'cal-next':     view.calM++; if (view.calM > 11) { view.calM = 0;  view.calY++; } render(); break;
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'add-project') {
    const name = f.elements.name.value.trim();
    if (name) addProject(name);
  } else if (f.dataset.form === 'add-activity') {
    const desc = f.elements.desc.value.trim();
    if (desc) addActivity(+f.dataset.project, desc);
  }
});

render();
