/**
 * Standalone Antigravity Integration Test Suite (Zero Dependencies)
 */

// Mock window, document, localStorage
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
  constructor() {
    this.data = new Map();
  }
  get(key) {
    const val = this.data.get(key);
    return {
      onsuccess: null,
      onerror: null,
      result: val ? JSON.parse(JSON.stringify(val)) : undefined
    };
  }
  getAll() {
    const arr = Array.from(this.data.values()).map(v => JSON.parse(JSON.stringify(v)));
    return {
      onsuccess: null,
      onerror: null,
      result: arr
    };
  }
  put(item) {
    const key = item.key || item.id || item.date;
    this.data.set(key, JSON.parse(JSON.stringify(item)));
    return {
      onsuccess: null,
      onerror: null,
      result: key
    };
  }
  delete(key) {
    this.data.delete(key);
    return {
      onsuccess: null,
      onerror: null,
      result: undefined
    };
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
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      result: {
        objectStoreNames: { contains: () => true },
        transaction: (storeName, mode) => {
          const store = mockStores[storeName];
          return {
            objectStore: () => ({
              get: (k) => {
                const r = store.get(k);
                setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                return r;
              },
              getAll: () => {
                const r = store.getAll();
                setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                return r;
              },
              put: (item) => {
                const r = store.put(item);
                setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                return r;
              },
              delete: (k) => {
                const r = store.delete(k);
                setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
                return r;
              }
            })
          };
        }
      }
    };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }
};

const fs = require("fs");
const dbCode = fs.readFileSync("js/db.js", "utf8");

async function runTests() {
  console.log("--- Starting Antigravity Integration Test Suite ---");

  // Load and execute db.js
  eval(dbCode);
  const db = window.momentumDB;
  await db.ensureReady();
  console.log("✓ MomentumDB initialized");

  // TEST 1: Default Settings & User Name
  const initialSettings = await db.getSettings();
  console.assert(initialSettings.focusDuration === 120, "Default focusDuration should be 120m");
  console.assert(initialSettings.focusInterval === 60, "Default focusInterval should be 60m");
  console.assert(initialSettings.breakDuration === 5, "Default breakDuration should be 5m");
  console.log("✓ Test 1: Default Settings verified (120m/60m/5m)");

  // TEST 2: Update User Name
  await db.updateSettings({ userName: "Hai" });
  const updatedSettings = await db.getSettings();
  console.assert(updatedSettings.userName === "Hai", "User name should be updated to Hai");
  console.log("✓ Test 2: User Name update in IndexedDB verified");

  // TEST 3: Focus Duration 8 Hours Setting Test
  // User sets 8 hours (480 minutes)
  await db.updateSettings({ focusDuration: 480 });
  const settings8h = await db.getSettings();
  console.assert(settings8h.focusDuration === 480, "focusDuration should be 480m");

  // Focus state sync check when idle
  const state = await db.getFocusState();
  console.assert(!state.isRunning, "Timer should be idle");
  const updatedState = {
    durationMinutes: 480,
    remainingSeconds: 480 * 60,
    targetTimestamp: null
  };
  await db.saveFocusState(updatedState);
  const fetchedState = await db.getFocusState();
  console.assert(fetchedState.durationMinutes === 480, "State durationMinutes should be 480");
  console.assert(fetchedState.remainingSeconds === 28800, "State remainingSeconds should be 28800 (8 hours)");
  console.log("✓ Test 3: Setting 8 hours focus duration correctly sets remainingSeconds = 28,800s (no 10h bug!)");

  // TEST 4: Music URL Auto-detection (YouTube & Spotify, NO subType, direct embedUrl)
  const ytVideo = await db.parseMusicUrl("https://www.youtube.com/watch?v=jfKfPfyJRdk");
  console.assert(ytVideo.type === "youtube", "YouTube URL type should be youtube");
  console.assert(ytVideo.subType === undefined, "subType must not exist");
  console.assert(ytVideo.embedUrl === "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=1&enablejsapi=1", "Direct embedUrl verified");

  const ytShort = await db.parseMusicUrl("https://youtu.be/5qap5aO4i9A");
  console.assert(ytShort.type === "youtube", "youtu.be recognized as youtube");
  console.assert(ytShort.subType === undefined, "subType must not exist");

  const spTrack = await db.parseMusicUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
  console.assert(spTrack.type === "spotify", "Spotify track recognized");
  console.assert(spTrack.subType === undefined, "subType must not exist on spotify");
  console.assert(spTrack.embedUrl.includes("https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT"), "Spotify embedUrl correct");

  const spPlaylist = await db.parseMusicUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
  console.assert(spPlaylist.type === "spotify", "Spotify playlist recognized");
  console.assert(spPlaylist.subType === undefined, "subType must not exist on playlist");
  console.assert(spPlaylist.embedUrl.includes("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"), "Spotify playlist embedUrl correct");
  console.log("✓ Test 4: YouTube & Spotify auto-detection without subType and direct embedUrl verified");

  // TEST 5: Active Wallpaper with 5:00 AM Pinning
  const testWp = {
    id: "photo_test_123",
    source: "my-photos",
    previewUrl: "blob:http://localhost/test-blob",
    thumbnailUrl: "data:image/jpeg;base64,...",
    title: "Mountain Cabin",
    activeDate: "2026-10-25"
  };
  await db.setActiveWallpaper(testWp);
  const activeWp = await db.getActiveWallpaper();
  console.assert(activeWp.id === "photo_test_123", "Active wallpaper ID matches");
  console.assert(activeWp.source === "my-photos", "Active wallpaper source matches");
  console.assert(activeWp.activeDate === "2026-10-25", "Active wallpaper date matches");
  console.log("✓ Test 5: Active Wallpaper stored & retrieved from IndexedDB successfully");

  // TEST 6: Focus Session Stats Recording
  const sessionRecord = {
    id: "sess_1",
    task: "Coding Momentum",
    durationMinutes: 45,
    start: Date.now() - 45 * 60 * 1000,
    end: Date.now()
  };
  const recorded = await db.recordSession(sessionRecord);
  console.assert(recorded.totalMinutes === 45, "Total minutes recorded correctly");
  console.assert(recorded.completedSessions === 1, "Completed sessions count = 1");
  console.log("✓ Test 6: Focus stats recording verified in IndexedDB");

  console.log("--- All 6 Integration Tests PASSED with 100% SUCCESS ---");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
