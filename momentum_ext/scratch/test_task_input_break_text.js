/**
 * Regression test: the break tab must not force "☕ Rest for Xm -
 * Recharge your energy" into the task input.
 *
 * Bug (pre-fix): updateTopButtonState() overwrote fsTaskInput.value with
 * the auto rest text whenever the break tab was active. startFocus()
 * later harvested input.value into state.currentTask, so the auto text
 * became the user's stored task and stuck permanently on the focus tab,
 * impossible to delete or replace.
 *
 * Required behavior:
 *   - Both Focus and Break tabs show the user's own task text.
 *   - With no user task, the input value stays empty so the placeholder
 *     ("I will focus on...") shows.
 *   - Stored state already polluted with the legacy auto text is
 *     scrubbed back to "" by render().
 */

const fs = require("fs");

// ---- Minimal browser mocks (same pattern as other scratch tests) -----------
global.window = {
  AudioContext: class {
    constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
    resume() {}
    createOscillator() { return { type: "sine", frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    createGain() { return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(16) }; }
    createBufferSource() { return { buffer: null, loop: false, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; }
    createBiquadFilter() { return { type: "lowpass", frequency: { setValueAtTime: () => {} }, connect: () => {} }; }
  },
  webkitAudioContext: null
};

global.document = {
  activeElement: null,
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

const store = {
  settings: { focusDuration: 120, breakDuration: 10, focusInterval: 60 },
  state: {
    isRunning: false,
    targetTimestamp: null,
    durationMinutes: 120,
    remainingSeconds: 7200,
    sessionStartTime: null,
    lastContinuousBase: 0,
    continuousFocusSeconds: 0,
    currentTask: "",
    breakUnlocked: false,
    breakIsRunning: false,
    breakTargetTimestamp: null,
    breakRemainingSeconds: 600,
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

let failures = 0;
function check(name, cond) {
  if (cond) console.log("  ok -", name);
  else { failures++; console.error("  FAIL -", name); }
}
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

async function main() {
  const code = fs.readFileSync("js/focus.js", "utf8");

  console.log("Test 0: source no longer assigns the auto rest text to the task input");
  check("no fsTaskInput auto rest-text assignment", !/fsTaskInput\.value\s*=\s*`☕/.test(code));
  check("legacy scrub regex present", /Rest for \\d\+m - Recharge your energy/.test(code));

  eval(code + "\nglobal.focusManager = focusManager;");
  const fm = global.focusManager;
  fm.isFocusModeOpen = false;
  fm.topFocusBtn = { querySelector: () => null, classList: { add: () => {}, remove: () => {}, toggle: () => {} } };
  fm.fsTaskInput = { value: "SENTINEL" };
  fm.sendExtMessage = async () => ({ success: true });

  const breakState = (task) => ({
    ...store.state,
    currentTab: "break",
    breakIsRunning: true,
    breakUnlocked: true,
    isRunning: true,
    currentTask: task
  });
  const focusState = (task) => ({ ...store.state, currentTab: "focus", currentTask: task });

  console.log("Test 1: break tab shows the user's own task text");
  fm.fsTaskInput.value = "SENTINEL";
  fm.updateDisplay(600, breakState("Write the report"), { ...store.settings });
  check("input keeps user text during break", fm.fsTaskInput.value === "Write the report");

  console.log("Test 2: break tab with no user task stays empty (placeholder shows)");
  fm.fsTaskInput.value = "SENTINEL";
  fm.updateDisplay(600, breakState(""), { ...store.settings });
  check("input empty during break when no task", fm.fsTaskInput.value === "");

  console.log("Test 3: focus tab shows the user's own task text");
  fm.fsTaskInput.value = "SENTINEL";
  fm.updateDisplay(7200, focusState("Plan sprint"), { ...store.settings });
  check("input shows user text on focus tab", fm.fsTaskInput.value === "Plan sprint");

  console.log("Test 4: legacy polluted currentTask is scrubbed by render()");
  store.state = { ...store.state, currentTask: "☕ Rest for 10m - Recharge your energy", currentTab: "break", breakIsRunning: true, breakUnlocked: true };
  fm.fsTaskInput.value = "SENTINEL";
  await fm.render();
  await flush();
  check("stored currentTask scrubbed to empty", store.state.currentTask === "");
  check("input empty after scrub (placeholder)", fm.fsTaskInput.value === "");

  console.log("Test 5: a real user task that merely mentions rest is NOT scrubbed");
  store.state = { ...store.state, currentTask: "Rest for 10m - Recharge your energy thật", currentTab: "focus", breakIsRunning: false };
  await fm.render();
  await flush();
  check("user text preserved", store.state.currentTask === "Rest for 10m - Recharge your energy thật");

  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("All task-input break-text tests passed.");
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
