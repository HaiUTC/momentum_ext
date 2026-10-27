/**
 * P0 Regression Test: Focus-mode hang (buttons dead, timer/music never start)
 *
 * Root cause covered here:
 *  1. MomentumDB.getFocusState() day-rollover used to call the public
 *     saveFocusState(), which itself calls getFocusState() while the
 *     stored date is still the old day -> infinite recursion, promise
 *     never settles.
 *  2. storage.js wrapped the promise-based browser.* storage API in a
 *     Chrome-style callback and discarded the returned promise -> any
 *     await on it could hang forever, with no timeout.
 *
 * Every storage call in this suite is guarded by a watchdog: if a call
 * does not settle in time, the test FAILS (instead of hanging forever,
 * which is exactly the bug being prevented).
 */

// ---------- Mocks (same style as test_integration.js) ----------
global.window = {};
global.document = {
  createElement: () => ({
    getContext: () => ({ drawImage: () => {} }),
    toDataURL: () => "data:image/jpeg;base64,mock"
  })
};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};

class MockStore {
  constructor() { this.data = new Map(); this.getCount = 0; }
  get(key) {
    this.getCount++;
    const val = this.data.get(key);
    return { onsuccess: null, onerror: null, result: val ? JSON.parse(JSON.stringify(val)) : undefined };
  }
  getAll() {
    const arr = Array.from(this.data.values()).map(v => JSON.parse(JSON.stringify(v)));
    return { onsuccess: null, onerror: null, result: arr };
  }
  put(item) {
    const key = item.key || item.id || item.date;
    this.data.set(key, JSON.parse(JSON.stringify(item)));
    return { onsuccess: null, onerror: null, result: key };
  }
  delete(key) {
    this.data.delete(key);
    return { onsuccess: null, onerror: null, result: undefined };
  }
}

const mockStores = {
  settings: new MockStore(),
  photos: new MockStore(),
  custom_sounds: new MockStore(),
  focus_state: new MockStore(),
  focus_stats: new MockStore()
};

global.indexedDB = {
  open: () => {
    const req = {
      onsuccess: null, onerror: null, onupgradeneeded: null,
      result: {
        objectStoreNames: { contains: () => true },
        transaction: (storeName) => {
          const store = mockStores[storeName];
          return {
            objectStore: () => ({
              get: (k) => { const r = store.get(k); setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; },
              getAll: () => { const r = store.getAll(); setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; },
              put: (item) => { const r = store.put(item); setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; },
              delete: (k) => { const r = store.delete(k); setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; }
            })
          };
        }
      }
    };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }
};

// ---------- Helpers ----------
function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function watchdog(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`WATCHDOG: ${label} did not settle within ${ms}ms`)), ms))
  ]);
}
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("✓ " + msg);
}

const fs = require("fs");

async function runTests() {
  console.log("--- P0 Focus-Hang Regression Suite ---");
  const today = localDateString();
  const yesterday = localDateString(new Date(Date.now() - 24 * 3600 * 1000));

  // ---------- Load db.js ----------
  eval(fs.readFileSync("js/db.js", "utf8"));
  const db = window.momentumDB;
  await watchdog(db.ensureReady(), 2000, "MomentumDB.ensureReady");
  console.log("✓ MomentumDB initialized");

  // ---------- TEST 1: rollover via the STORED path (fresh page load, cold cache) ----------
  mockStores.focus_state.data.set("timer_state", {
    key: "timer_state", date: yesterday, mode: "focus", isRunning: true,
    targetTimestamp: Date.now() - 1000, durationMinutes: 120, remainingSeconds: 42,
    sessionStartTime: Date.now() - 5000, currentTask: "old task",
    continuousFocusSeconds: 600, breakUnlocked: true,
    breakRemainingSeconds: 300, breakIsRunning: true, breakTargetTimestamp: Date.now() + 1000,
    currentTab: "break"
  });
  db.cache.focusState = null;
  const getsBefore = mockStores.focus_state.getCount;
  const state1 = await watchdog(db.getFocusState(), 2000, "getFocusState rollover (stored path)");
  assert(state1.date === today, `Test 1: rollover moved date to today (${state1.date} === ${today})`);
  assert(state1.isRunning === false && state1.breakIsRunning === false, "Test 1: rollover stopped running timers");
  assert(state1.remainingSeconds === 120 * 60, "Test 1: rollover reset remainingSeconds to the full focus duration");
  const getsUsed = mockStores.focus_state.getCount - getsBefore;
  assert(getsUsed <= 3, `Test 1: rollover used a bounded number of IDB reads (${getsUsed} <= 3, no recursion)`);
  assert(mockStores.focus_state.data.get("timer_state").date === today, "Test 1: rolled-over state was persisted to IndexedDB");
  const state1b = await watchdog(db.getFocusState(), 2000, "getFocusState second call (same day)");
  assert(state1b.date === today, "Test 1b: second getFocusState on the same day settles and keeps today's date");

  // ---------- TEST 2: rollover via the CACHE path ----------
  db.cache.focusState = {
    key: "timer_state", date: yesterday, mode: "focus", isRunning: true,
    targetTimestamp: Date.now() + 60000, durationMinutes: 120, remainingSeconds: 100,
    sessionStartTime: Date.now(), currentTask: "", continuousFocusSeconds: 10,
    breakUnlocked: false, breakRemainingSeconds: 300, breakIsRunning: false,
    breakTargetTimestamp: null, currentTab: "focus"
  };
  const state2 = await watchdog(db.getFocusState(), 2000, "getFocusState rollover (cache path)");
  assert(state2.date === today && state2.isRunning === false, "Test 2: cache-path rollover settles, moves to today and stops the timer");
  assert(db.cache.focusState.date === today, "Test 2: cache was updated to today BEFORE persisting (no stale-date loop)");

  // ---------- TEST 3: saveFocusState still merges & settles after rollover ----------
  const saved = await watchdog(db.saveFocusState({ currentTask: "regression" }), 2000, "saveFocusState after rollover");
  assert(saved.currentTask === "regression" && saved.date === today, "Test 3: saveFocusState merges the patch and settles");

  // ---------- Load storage.js with a healthy promise-based browser.* mock ----------
  const mockStorageLocal = {
    data: { active_sound: { id: "track-1", type: "spotify", title: "Mock" } },
    get(keys) {
      const out = {};
      const list = typeof keys === "string" ? [keys] : keys;
      list.forEach(k => { if (k in this.data) out[k] = this.data[k]; });
      return Promise.resolve(out);
    },
    set(items) { Object.assign(this.data, items); return Promise.resolve(); }
  };
  global.browser = { storage: { local: mockStorageLocal } };
  eval(fs.readFileSync("js/storage.js", "utf8"));
  const svc = window.storageService;
  assert(!!svc, "Test 4: storageService loaded");

  // ---------- TEST 4: storageService.getFocusState integrates with the fixed DB ----------
  const svcState = await watchdog(svc.getFocusState(), 3000, "storageService.getFocusState");
  assert(svcState.date === today, "Test 4: storageService.getFocusState settles with today's state");

  // ---------- TEST 5: promise-based storage.get is awaited directly (no callback) ----------
  const active = await watchdog(svc.getActiveSound(), 3000, "storageService.getActiveSound (healthy API)");
  assert(active && active.id === "track-1", "Test 5: getActiveSound returns the stored track via the promise API");

  // ---------- TEST 6: a storage API that NEVER settles can no longer hang callers ----------
  mockStorageLocal.get = () => new Promise(() => {}); // never resolves, never calls back
  mockStorageLocal.set = () => new Promise(() => {});
  const t0 = Date.now();
  const activeHung = await watchdog(svc.getActiveSound(), 8000, "storageService.getActiveSound (hanging API)");
  assert(activeHung === null || activeHung === undefined, `Test 6: getActiveSound fell back instead of hanging (${Date.now() - t0}ms)`);
  const settingsHung = await watchdog(svc.getSettings(), 10000, "storageService.getSettings (hanging browser storage, healthy DB)");
  assert(settingsHung && typeof settingsHung.focusDuration === "number", "Test 6b: getSettings still settles via the IndexedDB layer");

  console.log("--- ALL P0 REGRESSION TESTS PASSED ---");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("✗ P0 REGRESSION FAILURE:", err.message);
  process.exit(1);
});
