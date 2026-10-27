/**
 * Regression Test: Sounds popover re-render storm while Spotify is playing
 *
 * Bug: the Spotify embed posts playback state/progress messages repeatedly
 * during playback. SoundsManager's message handler used to call
 * renderGrid() for EVERY message carrying an isPaused flag — even when the
 * state had not changed. renderGrid() clears the grid (innerHTML = "") and
 * recreates every card, so while music played the popover constantly
 * flickered, thumbnails reloaded, scroll reset, and the playing/equalizer
 * CSS animation restarted from zero.
 *
 * Fix under test:
 *  1. The message handler ignores messages whose play/pause state equals
 *     the current state, and on a real change it updates the existing DOM
 *     in place via updatePlaybackStateUi() instead of renderGrid().
 *  2. renderGrid() coalesces overlapping calls instead of interleaving
 *     multiple clear+rebuild passes.
 */

const fs = require("fs");

// ---------- DOM stubs ----------
function makeEl() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    _classes: new Set(),
    _innerHTML: "",
    _text: "",
    rebuilds: 0,
    scrollHeight: 400,
    offsetHeight: 400,
    appendChild(child) { el.children.push(child); return child; },
    replaceChildren() { el.children = []; },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return el.children; },
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { bottom: 0, left: 0, top: 0, right: 0, width: 0, height: 0 }; }
  };
  el.classList = {
    add: (...cs) => cs.forEach(c => el._classes.add(c)),
    remove: (...cs) => cs.forEach(c => el._classes.delete(c)),
    toggle: (c, force) => {
      const on = force === undefined ? !el._classes.has(c) : !!force;
      if (on) el._classes.add(c); else el._classes.delete(c);
      return on;
    },
    contains: (c) => el._classes.has(c)
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = v;
      if (v === "") { el.rebuilds++; el.children = []; }
    }
  });
  Object.defineProperty(el, "textContent", {
    get() { return el._text; },
    set(v) { el._text = v; }
  });
  return el;
}

const elementsById = new Map();
function elFor(id) {
  if (!elementsById.has(id)) elementsById.set(id, makeEl());
  return elementsById.get(id);
}

const windowListeners = {};
global.window = {
  AudioContext: class {
    constructor() { this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; this.destination = {}; }
    resume() {}
    createOscillator() { return { frequency: { setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {} }; }
    createGain() { return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(16) }; }
    createBufferSource() { return { connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; }
    createBiquadFilter() { return { frequency: { setValueAtTime: () => {} }, connect: () => {} }; }
  },
  webkitAudioContext: null,
  addEventListener(type, fn) { windowListeners[type] = fn; },
  momentumDB: undefined
};
global.document = {
  getElementById: (id) => elFor(id),
  querySelector: () => makeEl(),
  createElement: () => makeEl(),
  createElementNS: () => makeEl(),
  addEventListener: () => {},
  documentElement: makeEl(),
  body: makeEl()
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.fetch = async () => ({
  json: async () => ({
    sound: {
      spotify: [{ id: "sp1", title: "Spotify One", thumbnailUrl: "https://example.com/1.jpg" }],
      youtube: [{ id: "yt1", title: "YT One", thumbnailUrl: "https://example.com/2.jpg" }]
    }
  })
});
global.storageService = {
  getCustomSounds: async () => [],
  getActiveSound: async () => ({ id: "sp1", type: "spotify", title: "Spotify One", thumbnailUrl: "https://example.com/1.jpg" }),
  saveActiveSound: async () => {}
};

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("✓ " + msg);
}

async function run() {
  console.log("--- Spotify Popover Re-render Regression Suite ---");
  const code = fs.readFileSync("js/focus.js", "utf8");
  eval(code + "\nglobal.SoundsManager = SoundsManager;");

  const uiCalls = [];
  const fakeFocusManager = {
    updateSoundscapeUi: (v) => uiCalls.push(v),
    soundscapePlayer: { play() {}, stop() {} }
  };

  const sm = new global.SoundsManager(fakeFocusManager);
  await sm.readyPromise;

  const grid = elFor("sounds-grid");
  const popover = elFor("sounds-popover");
  popover.classList.remove("hidden"); // popover is open

  assert(sm.activeTrack && sm.activeTrack.type === "spotify", "Setup: active track is Spotify");
  assert(grid.children.length === 1, `Setup: grid rendered once with the Spotify card (children=${grid.children.length})`);

  // Simulate "music is playing"
  sm.isPlaying = true;
  sm.lastUserToggleTime = 0;
  const baseRebuilds = grid.rebuilds;
  const baseChildren = grid.children.slice();
  uiCalls.length = 0;

  const fire = (data) => windowListeners["message"]({ origin: "https://open.spotify.com", data });

  // TEST 1: a burst of progress/state messages with UNCHANGED state
  for (let i = 0; i < 20; i++) fire({ isPaused: false });
  await new Promise(r => setTimeout(r, 50));
  assert(grid.rebuilds === baseRebuilds, `Test 1: 20 unchanged Spotify messages caused 0 grid rebuilds (rebuilds=${grid.rebuilds - baseRebuilds})`);
  assert(uiCalls.length === 0, "Test 1: no redundant UI updates for unchanged state");
  assert(grid.children[0] === baseChildren[0], "Test 1: existing card DOM nodes were preserved (CSS animation not restarted)");

  // TEST 2: a REAL state change (pause) updates in place, no rebuild
  fire({ isPaused: true });
  await new Promise(r => setTimeout(r, 50));
  assert(sm.isPlaying === false, "Test 2: pause state applied");
  assert(uiCalls.length === 1 && uiCalls[0] === false, "Test 2: soundscape UI updated exactly once");
  assert(grid.rebuilds === baseRebuilds, "Test 2: state change did NOT rebuild the grid");
  assert(grid.children[0] === baseChildren[0], "Test 2: card DOM node still the same element after pause");

  // TEST 3: repeated paused messages are ignored too
  for (let i = 0; i < 20; i++) fire({ isPaused: true });
  await new Promise(r => setTimeout(r, 50));
  assert(uiCalls.length === 1, "Test 3: repeated paused messages produced no extra UI updates");
  assert(grid.rebuilds === baseRebuilds, "Test 3: still zero rebuilds after 41 total messages");

  // TEST 4: overlapping renderGrid() calls coalesce (no duplicate cards)
  const before = grid.rebuilds;
  const pending = [sm.renderGrid(), sm.renderGrid(), sm.renderGrid(), sm.renderGrid(), sm.renderGrid()];
  await Promise.all(pending);
  await new Promise(r => setTimeout(r, 100)); // allow the single queued follow-up
  const rebuildDelta = grid.rebuilds - before;
  assert(rebuildDelta >= 1 && rebuildDelta <= 2, `Test 4: 5 overlapping renderGrid calls coalesced into ${rebuildDelta} rebuild(s) (<= 2)`);
  assert(grid.children.length === 1, `Test 4: grid has exactly 1 card, no duplicates (children=${grid.children.length})`);

  console.log("--- ALL SPOTIFY RE-RENDER REGRESSION TESTS PASSED ---");
  process.exit(0);
}

run().catch((err) => {
  console.error("✗ SPOTIFY RE-RENDER REGRESSION FAILURE:", err.message);
  process.exit(1);
});
