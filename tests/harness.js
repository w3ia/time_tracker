'use strict';

/* Loads app.js (a browser script with no exports) into a vm sandbox with
   stubbed document/localStorage, and exposes its internals for testing. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function makeEl() {
  return { textContent: '', innerHTML: '', classList: { toggle() {} }, dataset: {} };
}

function createApp(store = new Map()) {
  const els = new Map();          // id -> stub element, so tests can inspect rendered HTML
  const downloads = [];           // captured Blobs from exportCSV

  const sandbox = {
    console,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      getElementById(id) {
        if (!els.has(id)) els.set(id, makeEl());
        return els.get(id);
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ href: '', download: '', click() {} }),
    },
    setInterval: () => 0,
    confirm: () => true,
    Blob: class Blob {
      constructor(parts, opts) {
        this.text = parts.join('');
        this.type = opts && opts.type;
        downloads.push(this);
      }
    },
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(APP_SRC, ctx, { filename: 'app.js' });

  // Top-level let/const live in the context's global lexical scope, so a
  // second script in the same context can hand them back to us.
  const api = vm.runInContext(`({
    state, view, esc, clock, fmtDur, keyOf, todayKey, dateOfKey, rangeOfKey,
    overlapSec, actSecs, projSecs, totalSecs,
    getProject, getActivity, runningSession, isRunning,
    addProject, addActivity, startActivity, pauseActivity, finishActivity,
    deleteActivity, deleteProject, exportCSV, render,
  })`, ctx);

  return { ...api, store, els, downloads };
}

module.exports = { createApp };
