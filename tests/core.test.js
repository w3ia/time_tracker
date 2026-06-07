'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./harness');

const ts = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

/* ——— formatting ——— */

test('clock formats h:mm:ss', () => {
  const app = createApp();
  assert.equal(app.clock(0), '0:00:00');
  assert.equal(app.clock(59), '0:00:59');
  assert.equal(app.clock(3849), '1:04:09');
  assert.equal(app.clock(36000), '10:00:00');
});

test('fmtDur picks compact units', () => {
  const app = createApp();
  assert.equal(app.fmtDur(0), '—');
  assert.equal(app.fmtDur(45), '45s');
  assert.equal(app.fmtDur(125), '2m 05s');
  assert.equal(app.fmtDur(7440), '2h 04m');
});

test('esc neutralises HTML', () => {
  const app = createApp();
  assert.equal(app.esc(`<b onmouseover="x('&')">`), '&lt;b onmouseover=&quot;x(&#39;&amp;&#39;)&quot;&gt;');
});

/* ——— date helpers ——— */

test('keyOf/dateOfKey round-trip and rangeOfKey spans one day', () => {
  const app = createApp();
  const k = app.keyOf(new Date(2026, 5, 7)); // June 7 2026
  assert.equal(k, '2026-06-07');
  assert.equal(app.dateOfKey(k).getTime(), ts(2026, 6, 7));
  const [t0, t1] = app.rangeOfKey(k);
  assert.equal(t0, ts(2026, 6, 7));
  assert.equal(t1 - t0, 24 * 3600 * 1000);
});

/* ——— interval math ——— */

test('overlapSec clips sessions to a range', () => {
  const app = createApp();
  const [t0, t1] = app.rangeOfKey('2026-06-05');
  const inside  = { start: ts(2026, 6, 5, 9),  end: ts(2026, 6, 5, 9, 30) };
  const spills  = { start: ts(2026, 6, 4, 23), end: ts(2026, 6, 5, 1) };
  const outside = { start: ts(2026, 6, 4, 8),  end: ts(2026, 6, 4, 9) };
  assert.equal(app.overlapSec(inside, t0, t1), 1800);
  assert.equal(app.overlapSec(spills, t0, t1), 3600); // only the post-midnight hour
  assert.equal(app.overlapSec(outside, t0, t1), 0);
});

test('a session spanning midnight lands on both days', () => {
  const app = createApp();
  app.addProject('p');
  app.addActivity(app.state.projects[0].id, 'late night');
  const actId = app.state.activities[0].id;
  app.state.sessions.push({ id: 99, activityId: actId, start: ts(2026, 6, 4, 23), end: ts(2026, 6, 5, 1) });

  const [d1t0, d1t1] = app.rangeOfKey('2026-06-04');
  const [d2t0, d2t1] = app.rangeOfKey('2026-06-05');
  assert.equal(app.actSecs(actId, d1t0, d1t1), 3600);
  assert.equal(app.actSecs(actId, d2t0, d2t1), 3600);
  assert.equal(app.totalSecs(d1t0, d2t1), 7200);
});

/* ——— projects & activities ——— */

test('addProject assigns cycling colors; addActivity attaches to project', () => {
  const app = createApp();
  for (let i = 0; i < 9; i++) app.addProject(`proj ${i}`);
  assert.equal(app.state.projects.length, 9);
  assert.equal(app.state.projects[8].color, app.state.projects[0].color); // palette of 8 wraps

  app.addActivity(app.state.projects[0].id, 'site updates');
  assert.equal(app.state.activities.length, 1);
  assert.equal(app.state.activities[0].projectId, app.state.projects[0].id);
  assert.equal(app.state.activities[0].done, false);
});

/* ——— timer lifecycle & context switching ——— */

test('startActivity opens a running session', () => {
  const app = createApp();
  app.addProject('p');
  app.addActivity(app.state.projects[0].id, 'a');
  const id = app.state.activities[0].id;

  app.startActivity(id);
  assert.ok(app.isRunning(id));
  assert.equal(app.runningSession().activityId, id);
  assert.equal(app.runningSession().end, null);
});

test('starting another activity pauses the running one (context switch)', () => {
  const app = createApp();
  app.addProject('p');
  const pid = app.state.projects[0].id;
  app.addActivity(pid, 'site updates');
  app.addActivity(pid, 'deploy');
  const [a1, a2] = app.state.activities.map(a => a.id);

  app.startActivity(a1);
  app.startActivity(a2);

  assert.ok(!app.isRunning(a1));
  assert.ok(app.isRunning(a2));
  const first = app.state.sessions.find(s => s.activityId === a1);
  assert.ok(first.end !== null, 'first session must be closed');
  assert.equal(app.state.sessions.filter(s => !s.end).length, 1, 'only one running session ever');
});

test('pause closes the session; resume opens a new one and time accumulates', () => {
  const app = createApp();
  app.addProject('p');
  app.addActivity(app.state.projects[0].id, 'a');
  const id = app.state.activities[0].id;

  app.startActivity(id);
  app.pauseActivity();
  assert.equal(app.runningSession(), undefined);

  app.startActivity(id); // resume
  app.pauseActivity();
  assert.equal(app.state.sessions.filter(s => s.activityId === id).length, 2);

  // overwrite with fixed times: 10:00–10:30 and 11:00–11:15 → 45m
  const [s1, s2] = app.state.sessions;
  s1.start = ts(2026, 6, 5, 10); s1.end = ts(2026, 6, 5, 10, 30);
  s2.start = ts(2026, 6, 5, 11); s2.end = ts(2026, 6, 5, 11, 15);
  const [t0, t1] = app.rangeOfKey('2026-06-05');
  assert.equal(app.actSecs(id, t0, t1), 2700);
  assert.equal(app.projSecs(app.state.projects[0].id, t0, t1), 2700);
});

test('finishActivity pauses and toggles done; restarting reopens', () => {
  const app = createApp();
  app.addProject('p');
  app.addActivity(app.state.projects[0].id, 'a');
  const id = app.state.activities[0].id;

  app.startActivity(id);
  app.finishActivity(id);
  assert.equal(app.runningSession(), undefined);
  assert.equal(app.getActivity(id).done, true);

  app.startActivity(id);
  assert.equal(app.getActivity(id).done, false, 'restart clears done');
  assert.ok(app.isRunning(id));
});

/* ——— deletion cascades ——— */

test('deleteActivity removes its sessions; deleteProject removes everything under it', () => {
  const app = createApp(); // confirm() is stubbed to true
  app.addProject('p');
  const pid = app.state.projects[0].id;
  app.addActivity(pid, 'a1');
  app.addActivity(pid, 'a2');
  const [a1, a2] = app.state.activities.map(a => a.id);
  app.startActivity(a1); app.pauseActivity();
  app.startActivity(a2); app.pauseActivity();

  app.deleteActivity(a1);
  assert.equal(app.state.activities.length, 1);
  assert.ok(app.state.sessions.every(s => s.activityId !== a1));

  app.deleteProject(pid);
  assert.equal(app.state.projects.length, 0);
  assert.equal(app.state.activities.length, 0);
  assert.equal(app.state.sessions.length, 0);
});

/* ——— persistence ——— */

test('state survives a reload via localStorage', () => {
  const store = new Map();
  const app1 = createApp(store);
  app1.addProject('exalt.ai website');
  app1.addActivity(app1.state.projects[0].id, 'deploy');
  app1.startActivity(app1.state.activities[0].id);
  app1.pauseActivity();

  const app2 = createApp(store); // fresh instance, same storage
  assert.equal(app2.state.projects[0].name, 'exalt.ai website');
  assert.equal(app2.state.activities[0].description, 'deploy');
  assert.equal(app2.state.sessions.length, 1);
  assert.ok(app2.state.sessions[0].end !== null);
});

/* ——— rendering smoke tests ——— */

test('render shows projects and the running activity in the hero', () => {
  const app = createApp();
  app.addProject('exalt.ai website');
  app.addActivity(app.state.projects[0].id, 'site updates');

  let html = app.els.get('app').innerHTML;
  assert.match(html, /exalt\.ai website/);
  assert.match(html, /Nothing running/);

  app.startActivity(app.state.activities[0].id);
  html = app.els.get('app').innerHTML;
  assert.match(html, /On the clock/);
  assert.match(html, /site updates/);
});

test('rendered output escapes hostile names', () => {
  const app = createApp();
  app.addProject('<script>alert(1)</script>');
  const html = app.els.get('app').innerHTML;
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

/* ——— CSV export ——— */

test('exportCSV emits BOM, header, quoting, and correct durations', () => {
  const app = createApp();
  app.addProject('exalt.ai website');
  const pid = app.state.projects[0].id;
  app.addActivity(pid, 'deploy, then "verify"');
  const aid = app.state.activities[0].id;
  app.state.sessions.push({ id: 50, activityId: aid, start: ts(2026, 6, 5, 9), end: ts(2026, 6, 5, 9, 30) });

  app.exportCSV();
  assert.equal(app.downloads.length, 1);
  const text = app.downloads[0].text;

  assert.ok(text.startsWith('﻿'), 'has UTF-8 BOM for Sheets/Excel');
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0], '"Date","Project","Activity","Start","End","Duration (sec)","Duration (h:mm:ss)"');
  assert.equal(lines.length, 2);
  assert.equal(
    lines[1],
    '"2026-06-05","exalt.ai website","deploy, then ""verify""","2026-06-05 09:00:00","2026-06-05 09:30:00","1800","0:30:00"'
  );
});

test('exportCSV marks an in-flight session as (running)', () => {
  const app = createApp();
  app.addProject('p');
  app.addActivity(app.state.projects[0].id, 'a');
  app.startActivity(app.state.activities[0].id);

  app.exportCSV();
  const lines = app.downloads[0].text.split('\r\n');
  assert.match(lines[1], /"\(running\)"/);
});
