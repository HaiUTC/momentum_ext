/**
 * Test Focus Mode Auto-Audio, Timer Countdown, Break Clock Chime & Resumption
 */

const fs = require("fs");

// Minimal browser mocks
global.window = {
  AudioContext: class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() { this.state = "running"; }
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {}
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
          linearRampToValueAtTime: () => {}
        },
        connect: () => {}
      };
    }
    createBuffer() {
      return {
        getChannelData: () => new Float32Array(88200)
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {}
      };
    }
    createBiquadFilter() {
      return {
        type: "lowpass",
        frequency: { setValueAtTime: () => {} },
        connect: () => {}
      };
    }
  },
  webkitAudioContext: null
};

global.document = {
  getElementById: () => null,
  addEventListener: () => {},
  documentElement: {
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }
  },
  body: {
    classList: { add: () => {}, remove: () => {}, toggle: () => {} }
  }
};

global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); }
};

global.storageService = {
  getSettingsSync: () => ({ focusModeActive: true, focusDuration: 120, breakDuration: 5 }),
  getFocusStateSync: () => ({ isRunning: false, remainingSeconds: 7200, currentTab: "focus" }),
  getSettings: async () => ({ focusDuration: 120, breakDuration: 5, focusInterval: 60 }),
  getFocusState: async () => ({ isRunning: false, remainingSeconds: 7200, currentTab: "focus", breakUnlocked: false }),
  saveFocusState: async (s) => s,
  syncTodayFocusSeconds: async () => {},
  setSetting: async () => {}
};

async function testAudioBreakFlow() {
  console.log("--- Testing Focus Mode Auto Music & Clock Chime Break Transition ---");

  // Read focus.js code
  const code = fs.readFileSync("js/focus.js", "utf8");
  eval(code + "\nglobal.focusManager = focusManager;\nglobal.ChimePlayer = ChimePlayer;");

  const fm = global.focusManager;

  let musicPlayCount = 0;
  let musicPauseCount = 0;
  let chimePlayCount = 0;

  // Mock soundsManager
  fm.soundsManager = {
    isPlaying: false,
    play: async () => {
      musicPlayCount++;
      fm.soundsManager.isPlaying = true;
    },
    pause: () => {
      musicPauseCount++;
      fm.soundsManager.isPlaying = false;
    }
  };

  // Spy on chimePlayer
  fm.chimePlayer = new ChimePlayer();
  const origPlayChime = fm.chimePlayer.playChime.bind(fm.chimePlayer);
  fm.chimePlayer.playChime = () => {
    chimePlayCount++;
    origPlayChime();
  };

  // Mock sendExtMessage
  fm.sendExtMessage = async () => ({ success: true });
  fm.render = async () => {};

  // 1. Enter Focus Mode
  console.log("Step 1: User enters Focus Mode...");
  await fm.openFullscreenFocus(true, true);
  console.assert(musicPlayCount === 1, "Music must start playing when entering Focus Mode");
  console.assert(fm.soundsManager.isPlaying === true, "Music should be playing");
  console.log("✓ Step 1: Music auto-started on entering focus mode");

  // 2. Break Time Arrives (startBreak)
  console.log("Step 2: Break Time arrives...");
  await fm.startBreak();
  console.assert(musicPauseCount === 1, "Music must be paused during Break");
  console.assert(fm.soundsManager.isPlaying === false, "Music should be stopped");
  console.assert(chimePlayCount === 1, "Clock chime must play when break starts");
  console.log("✓ Step 2: Music paused and clock chime played when Break started");

  // 3. Break Time Ends (finishBreak)
  console.log("Step 3: Break Time ends...");
  await fm.finishBreak();
  console.assert(chimePlayCount === 2, "Clock chime must play again when break finishes");
  console.assert(musicPlayCount === 2, "Music must resume playing after Break");
  console.assert(fm.soundsManager.isPlaying === true, "Music is active again");
  console.log("✓ Step 3: Clock chime played and music resumed after Break finished");

  // 4. User pauses timer
  console.log("Step 4: User pauses focus timer...");
  await fm.pauseTimer();
  console.assert(musicPauseCount === 2, "Music must pause when timer pauses");

  // 5. User resumes timer
  console.log("Step 5: User resumes focus timer...");
  await fm.resumeTimer();
  console.assert(musicPlayCount === 3, "Music must resume when timer resumes");
  console.log("✓ Steps 4 & 5: Pause and resume correctly control audio");

  console.log("--- All Focus Audio & Clock Chime Break Tests PASSED with 100% SUCCESS ---");
}

testAudioBreakFlow().catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});
