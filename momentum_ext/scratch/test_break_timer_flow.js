/**
 * Regression test: break timer must actually count down.
 *
 * Bug (pre-fix): when the continuous-focus streak reached the unlock
 * interval, the render() tick called startBreak() — but startBreak()
 * never persisted breakUnlocked=true, and the focus timer (which keeps
 * running during the break by design) kept the streak above the
 * interval. Every fresh render() therefore re-entered startBreak() and
 * pushed breakTargetTimestamp forward again, so the break countdown
 * looked frozen at its full duration, the chime re-rang, and the break
 * never finished.
 *
 * This test drives the real FocusManager from js/focus.js with an
 * in-memory storageService and a fake clock, and verifies the flow the
 * user asked for:
 *   focus (streak >= interval) -> startBreak
 *   -> 5s chime announcement (display stays at full break duration)
 *   -> break counts down monotonically (never resets)
 *   -> focus target timestamp is untouched the whole time
 *   -> at <=5s remaining the warning chime plays exactly once
 *   -> break ends, tab switches back to focus, music resumes.
 */

const fs = require("fs");

// ---- Fake clock ------------------------------------------------------------
let fakeNow = 1700000000000;
const realDateNow = Date.now;
Date.now = () => fakeNow;

// ---- Captured interval -----------------------------------------------------
let tickCallback = null;
global.setInterval = (fn) => { tickCallback = fn; return 1; };
global.clearInterval = () => { tickCallback = null; };

// ---- Minimal browser mocks (same pattern as other scratch tests) -----------
global.window = {
  AudioContext: class {
    constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
    resume() {}
    createOscillator() {
      return { type: "sine", frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} };
    }
    createGain() {
      return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} };
    }
    createBuffer() { return { getChannelData: () => new Float32Array(16) }; }
    createBufferSource() { return { buffer: null, loop: false, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; }
    createBiquadFilter() { return { type: "lowpass", frequency: { setValueAtTime: () => {} }, connect: () => {} }; }
  },
  webkitAudioContext: null
};

global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  documentElement: { classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
  body: { classList: { add: () => {}, remove: () => {}, toggle: () => {} } }
};

global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};

// ---- In-memory storageService ----------------------------------------------
const T0 = fakeNow;
const FOCUS_TARGET = T0 + 3600 * 1000; // focus ends 1h from now

const store = {
  settings: { focusDuration: 120, breakDuration: 5, focusInterval: 1 }, // interval = 60s
  state: {
    date: "2023-11-14",
    isRunning: true,
    targetTimestamp: FOCUS_TARGET,
    durationMinutes: 120,
    remainingSeconds: 3600,
    sessionStartTime: T0 - 61000, // streak already 61s > 60s interval
    lastContinuousBase: 0,
    continuousFocusSeconds: 61,
    currentTask: "Deep work",
    breakUnlocked: false,
    breakIsRunning: false,
    breakTargetTimestamp: null,
    breakRemainingSeconds: 300,
    breakAnnounceUntil: null,
    breakEndChimePlayed: false,
    currentTab: "focus"
  }
};

global.storageService = {
  getSettingsSync: () => ({ ...store.settings }),
  getFocusStateSync: () => ({ ...store.state }),
  getSettings: async () => ({ ...store.settings }),
  getFocusState: async () => ({ ...store.state }),
  saveFocusState: async (partial) => { store.state = { ...store.state, ...partial }; return { ...store.state }; },
  syncTodayFocusSeconds: async () => {},
  getActiveSound: async () => null,
  saveActiveSound: async () => {},
  getCustomSounds: async () => [],
  setSetting: async () => {}
};

// ---- Assertions -------------------------------------------------------------
let failures = 0;
function check(name, cond) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.error("  FAIL -", name); }
}
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

async function main() {
  const code = fs.readFileSync("js/focus.js", "utf8");
  eval(code + "\nglobal.focusManager = focusManager;");

  const fm = global.focusManager;
  fm.isFocusModeOpen = true;

  let chimeSeqCount = 0;
  let musicPlayCount = 0;
  let musicPauseCount = 0;
  fm.chimePlayer = {
    playChime: () => {},
    playChimeSequence: () => { chimeSeqCount++; }
  };
  fm.soundsManager = {
    isPlaying: true,
    readyPromise: Promise.resolve(),
    play: async () => { musicPlayCount++; fm.soundsManager.isPlaying = true; },
    pause: () => { musicPauseCount++; fm.soundsManager.isPlaying = false; }
  };
  fm.soundscapePlayer = { play: () => {}, stop: () => {} };
  fm.sendExtMessage = async () => ({ success: true });

  const displayLog = [];
  const origUpdateDisplay = fm.updateDisplay.bind(fm);
  fm.updateDisplay = (secs, state, settings) => {
    displayLog.push({ secs, tab: state && state.currentTab });
    try { origUpdateDisplay(secs, state, settings); } catch (e) {}
  };
  fm.updateButtons = () => {};
  fm.updateTopButtonState = () => {};

  console.log("Test 1: streak reaching the interval auto-starts the break");
  await fm.render();
  await flush();
  check("tick interval installed", typeof tickCallback === "function");
  tickCallback(); // continuous (61s) >= interval (60s) -> startBreak()
  await flush();
  check("break is running", store.state.breakIsRunning === true);
  check("current tab is break", store.state.currentTab === "break");
  check("breakUnlocked persisted true", store.state.breakUnlocked === true);
  check("start chime sequence played once", chimeSeqCount === 1);
  check("music paused at break start", musicPauseCount >= 1);
  const breakTarget = store.state.breakTargetTimestamp;
  check("break target = now + 5s chime + 5min break", breakTarget === T0 + 5000 + 300 * 1000);
  check("focus target untouched", store.state.targetTimestamp === FOCUS_TARGET);
  check("focus still running", store.state.isRunning === true);

  console.log("Test 2: during the 5s chime the display holds at the full break duration");
  displayLog.length = 0;
  fakeNow = T0 + 4500;
  tickCallback();
  await flush();
  const duringChime = displayLog.filter((d) => d.tab === "break").pop();
  check("display shows 300 during chime", duringChime && duringChime.secs === 300);

  console.log("Test 3: after the chime the break counts down and never resets");
  const samples = [];
  for (const t of [T0 + 6500, T0 + 30000, T0 + 65000, T0 + 125000]) {
    displayLog.length = 0;
    fakeNow = t;
    tickCallback();
    await flush();
    const d = displayLog.filter((x) => x.tab === "break").pop();
    samples.push(d ? d.secs : null);
    check("break target never pushed forward @" + t, store.state.breakTargetTimestamp === breakTarget);
    check("focus target still untouched @" + t, store.state.targetTimestamp === FOCUS_TARGET);
  }
  check("samples are 299/275/240/180-ish and strictly decreasing",
    samples[0] === 299 && samples.every((v, i) => i === 0 || v < samples[i - 1]));
  check("startBreak did not re-enter (chime still 1)", chimeSeqCount === 1);

  console.log("Test 4: final-5s warning chime plays exactly once");
  fakeNow = breakTarget - 4000; // 4s remaining
  tickCallback();
  await flush();
  check("warning chime played", chimeSeqCount === 2);
  check("breakEndChimePlayed persisted", store.state.breakEndChimePlayed === true);
  fakeNow = breakTarget - 3000;
  tickCallback();
  await flush();
  check("warning chime not repeated", chimeSeqCount === 2);

  console.log("Test 5: break ends -> back to focus, music resumes");
  fakeNow = breakTarget + 100;
  tickCallback();
  await flush();
  check("break no longer running", store.state.breakIsRunning === false);
  check("tab back to focus", store.state.currentTab === "focus");
  check("breakEndChimePlayed reset", store.state.breakEndChimePlayed === false);
  check("music resumed", musicPlayCount >= 1);
  check("focus target STILL untouched at the end", store.state.targetTimestamp === FOCUS_TARGET);

  Date.now = realDateNow;
  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("All break timer flow tests passed.");
}

main().catch((err) => {
  Date.now = realDateNow;
  console.error("Test crashed:", err);
  process.exit(1);
});
