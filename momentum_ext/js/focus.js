/**
 * Focus / Pomodoro UI Manager for Momentum Firefox Extension
 * Coordinates with background.js alarms, controls Fullscreen Focus Mode (matching Momentum UI),
 * handles timer actions, soundscapes, and transitions between normal clock and focus mode.
 */

class SoundscapePlayer {
  constructor() {
    this.audioCtx = null;
    this.isPlaying = false;
    this.gainNode = null;
    this.noiseNode = null;
    this.filterNode = null;
    this.stopTimeout = null;
  }

  toggle() {
    if (this.isPlaying) {
      this.stop();
      return false;
    } else {
      return this.play();
    }
  }

  play() {
    try {
      if (this.stopTimeout) {
        clearTimeout(this.stopTimeout);
        this.stopTimeout = null;
      }

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return false;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      // Generate brown/pink noise: soothing low rumbling ambient stream
      const bufferSize = 2 * this.audioCtx.sampleRate;
      const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
      }

      this.noiseNode = this.audioCtx.createBufferSource();
      this.noiseNode.buffer = noiseBuffer;
      this.noiseNode.loop = true;

      // Warm low-pass filter
      this.filterNode = this.audioCtx.createBiquadFilter();
      this.filterNode.type = "lowpass";
      this.filterNode.frequency.setValueAtTime(450, this.audioCtx.currentTime);

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.setValueAtTime(0.01, this.audioCtx.currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(0.35, this.audioCtx.currentTime + 1.2);

      this.noiseNode.connect(this.filterNode);
      this.filterNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.noiseNode.start();
      this.isPlaying = true;
      return true;
    } catch (e) {
      console.warn("Audio playback not supported or blocked", e);
      this.isPlaying = false;
      return false;
    }
  }

  stop() {
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout);
      this.stopTimeout = null;
    }
    const nodeToStop = this.noiseNode;
    if (this.gainNode && this.audioCtx) {
      try {
        this.gainNode.gain.linearRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
        this.stopTimeout = setTimeout(() => {
          if (nodeToStop) {
            try { nodeToStop.stop(); } catch (e) {}
            try { nodeToStop.disconnect(); } catch (e) {}
          }
          if (this.noiseNode === nodeToStop) {
            this.noiseNode = null;
          }
          this.stopTimeout = null;
        }, 300);
      } catch (e) {
        if (nodeToStop) {
          try { nodeToStop.stop(); } catch (e) {}
        }
        if (this.noiseNode === nodeToStop) {
          this.noiseNode = null;
        }
      }
    } else if (nodeToStop) {
      try { nodeToStop.stop(); } catch (e) {}
      if (this.noiseNode === nodeToStop) {
        this.noiseNode = null;
      }
    }
    this.isPlaying = false;
  }
}

/**
 * ChimePlayer
 * Generates an acoustic, warm, dual-tone clock bell / chime sound using Web Audio API.
 * Signals the start of break time and the return to focus mode.
 */
class ChimePlayer {
  constructor() {
    this.audioCtx = null;
  }

  getAudioContext() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return null;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
      return this.audioCtx;
    } catch (e) {
      return null;
    }
  }

  playChime() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Dual-strike clock chime (Ding - Dong)
      // Strike 1: Note A5 (880 Hz) at t = 0
      this.strike(ctx, now, 880, 0.35);
      // Strike 2: Note D6 (1174.66 Hz) at t = 0.28s
      this.strike(ctx, now + 0.28, 1174.66, 0.40);
    } catch (err) {
      console.warn("[ChimePlayer] Play chime warning:", err);
    }
  }

  /**
   * Repeat the dual-tone strike so the notification stays audible for
   * roughly totalMs and then stops on its own (each strike decays
   * naturally; the last strike is scheduled to end at ~totalMs).
   * Used for the 5s break-start announcement and the 5s warning
   * before the break ends.
   */
  playChimeSequence(totalMs = 5000) {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const totalSec = Math.max(0.5, totalMs / 1000);
      const stepSec = 1.4;   // spacing between strikes
      const decaySec = 2.2;  // longest partial decay in strike()
      const strikeCount = Math.max(1, Math.floor((totalSec - decaySec) / stepSec) + 1);

      for (let i = 0; i < strikeCount; i++) {
        const start = ctx.currentTime + i * stepSec;
        this.strike(ctx, start, 880, 0.35);
        this.strike(ctx, start + 0.28, 1174.66, 0.40);
      }
    } catch (err) {
      console.warn("[ChimePlayer] Play chime sequence warning:", err);
    }
  }

  strike(ctx, startTime, freq, masterGain) {
    const partials = [
      { ratio: 1.0, gain: 0.60, decay: 2.2 },
      { ratio: 2.76, gain: 0.25, decay: 1.4 },
      { ratio: 5.40, gain: 0.12, decay: 0.8 },
      { ratio: 8.93, gain: 0.06, decay: 0.4 }
    ];

    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * p.ratio, startTime);

      // Fast attack simulating metallic hammer strike
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(masterGain * p.gain, startTime + 0.006);
      // Smooth natural exponential decay
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + p.decay);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + p.decay + 0.05);
    });
  }
}

// Cinematic quotes for Focus transitions (exactly 5-8 words each)
const ENTER_FOCUS_PHRASES = [
  "Silence the noise, find your deep flow.",
  "Clear your mind and do great work.",
  "Step into focus, master your moment today.",
  "Let everything go, embrace the quiet focus.",
  "Tune out distraction, unlock your true potential."
];

const EXIT_FOCUS_PHRASES = [
  "Rest your mind, great progress was made.",
  "Take a deep breath and recharge now.",
  "Celebrate your effort, enjoy the calm moment.",
  "Step back, breathe, and appreciate your focus.",
  "Every focused moment brings you closer forward."
];

/**
 * SoundsManager
 * Controls Sounds Popover, Library loading (Spotify & YouTube),
 * Now Playing Embeds, Dynamic blurred Now Playing button,
 * Card equalizers, Custom links addition and deletion.
 */
class SoundsManager {
  constructor(focusManager) {
    this.focusManager = focusManager;
    this.popover = document.getElementById("sounds-popover");
    this.btnOpenAdd = document.getElementById("btn-sound-add-open");
    this.btnAddBack = document.getElementById("btn-sound-add-back");
    this.btnPlayerBack = document.getElementById("btn-sound-player-back");
    this.btnNowPlaying = document.getElementById("btn-sound-now-playing");
    this.nowPlayingBg = document.getElementById("sound-now-playing-bg");
    this.nowPlayingHeaderThumb = document.getElementById("now-playing-header-thumb");
    this.nowPlayingHeaderTitle = document.getElementById("now-playing-header-title");
    this.nowPlayingHeaderActions = document.getElementById("now-playing-header-actions");
    this.btnPlayerMore = document.getElementById("btn-player-more");
    this.embedContainer = document.getElementById("sounds-embed-container");
    this.gridContainer = document.getElementById("sounds-grid");
    this.inputSoundUrl = document.getElementById("input-sound-url");
    this.addStatusMsg = document.getElementById("sound-add-status");
    this.tabSpotify = document.getElementById("sound-tab-spotify");
    this.tabYoutube = document.getElementById("sound-tab-youtube");
    this.deletePopover = document.getElementById("sound-delete-popover");
    this.btnDeleteConfirm = document.getElementById("btn-sound-delete-confirm");

    this.sliderViewport = document.getElementById("sounds-slider-viewport");
    this.sliderTrack = document.getElementById("sounds-slider-track");
    this.viewGrid = document.getElementById("sounds-view-grid");
    this.viewAdd = document.getElementById("sounds-view-add");
    this.viewPlayer = document.getElementById("sounds-view-player");

    this.coverImg = document.querySelector("#focus-soundscape-btn .soundscape-album-cover");
    this.playDisc = document.querySelector("#focus-soundscape-btn .soundscape-play-disc");

    this.currentTab = "spotify"; // "spotify" | "youtube"
    this.currentView = "grid";   // "grid" | "add" | "player"
    this.library = { youtube: [], spotify: [] };
    this.customSounds = [];
    this.activeTrack = null;
    this.isPlaying = false;
    this.lastUserToggleTime = 0;
    this.pendingDeleteTrack = null;

    this.readyPromise = this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadLibrary();
  }

  async loadLibrary() {
    try {
      const url = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL("assets/sound/index.json")
        : "assets/sound/index.json";
      // Bounded fetch: a stalled request must not stall readyPromise —
      // FocusManager.init() and play() both wait on it.
      let resp;
      if (typeof AbortController !== "undefined") {
        const controller = new AbortController();
        const fetchTimer = setTimeout(() => controller.abort(), 3000);
        try {
          resp = await fetch(url, { signal: controller.signal });
        } finally {
          clearTimeout(fetchTimer);
        }
      } else {
        resp = await fetch(url);
      }
      const data = await resp.json();
      if (data && data.sound) {
        this.library.youtube = (data.sound.youtube || []).map(t => ({ ...t, type: "youtube" }));
        this.library.spotify = (data.sound.spotify || []).map(t => ({ ...t, type: "spotify" }));
      }
    } catch (err) {
      console.warn("Could not load assets/sound/index.json:", err);
    }

    try {
      this.customSounds = await storageService.getCustomSounds();
    } catch (e) {
      this.customSounds = [];
    }

    try {
      const savedActive = await storageService.getActiveSound();
      if (savedActive) {
        this.activeTrack = savedActive;
      } else if (this.library.spotify.length > 0) {
        this.activeTrack = this.library.spotify[0];
      } else {
        this.activeTrack = {
          id: "focus-flow-default",
          title: "Focus Flow",
          type: "soundscape",
          thumbnailUrl: "assets/focus-flow-cover.png",
          isCustom: false
        };
      }

      // Auto-migrate ended Lofi Girl livestream ID X4VbdwhkE10 to active stream 5qap5aO4i9A
      if (this.activeTrack && this.activeTrack.id === "X4VbdwhkE10") {
        this.activeTrack.id = "5qap5aO4i9A";
        this.activeTrack.thumbnailUrl = "https://i.ytimg.com/vi/5qap5aO4i9A/hqdefault.jpg";
        await storageService.saveActiveSound(this.activeTrack);
      }
    } catch (e) {
      this.activeTrack = {
        id: "focus-flow-default",
        title: "Focus Flow",
        type: "soundscape",
        thumbnailUrl: "assets/focus-flow-cover.png",
        isCustom: false
      };
    }

    if (this.activeTrack) {
      this.updateNowPlayingButton(this.activeTrack);
      this.updateTopLeftCover(this.activeTrack);
    }

    this.renderGrid();
    this.updateViewportHeight("grid");
  }

  bindEvents() {
    // 1. Tab switches
    if (this.tabSpotify) {
      this.tabSpotify.addEventListener("click", () => {
        this.currentTab = "spotify";
        this.tabSpotify.classList.add("active");
        if (this.tabYoutube) this.tabYoutube.classList.remove("active");
        this.renderGrid();
      });
    }

    if (this.tabYoutube) {
      this.tabYoutube.addEventListener("click", () => {
        this.currentTab = "youtube";
        this.tabYoutube.classList.add("active");
        if (this.tabSpotify) this.tabSpotify.classList.remove("active");
        this.renderGrid();
      });
    }

    // 2. Open Add View
    if (this.btnOpenAdd) {
      this.btnOpenAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showView("add");
      });
    }

    // 3. Back buttons
    if (this.btnAddBack) {
      this.btnAddBack.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showView("grid");
      });
    }

    if (this.btnPlayerBack) {
      this.btnPlayerBack.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showView("grid");
      });
    }

    // 4. Now Playing button
    if (this.btnNowPlaying) {
      this.btnNowPlaying.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeTrack) {
          this.showView("player");
        }
      });
    }

    // 5. Add Music Input
    if (this.inputSoundUrl) {
      this.inputSoundUrl.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await this.handleAddMusic(this.inputSoundUrl.value);
        }
      });
    }

    // 6. Player header more button for custom songs
    if (this.btnPlayerMore) {
      this.btnPlayerMore.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.activeTrack && this.activeTrack.isCustom) {
          this.openDeletePopover(this.activeTrack, this.btnPlayerMore);
        }
      });
    }

    // 7. Delete confirm button
    if (this.btnDeleteConfirm) {
      this.btnDeleteConfirm.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.confirmDelete();
      });
    }

    // 8. Outside click listener
    document.addEventListener("click", (e) => {
      // Handle delete popover dismissal
      if (this.deletePopover && !this.deletePopover.classList.contains("hidden")) {
        const isInsideDelete = this.deletePopover.contains(e.target);
        const isMoreBtn = e.target.closest(".sound-card-more-btn") || e.target.closest("#btn-player-more");
        if (!isInsideDelete && !isMoreBtn) {
          this.closeDeletePopover();
        }
      }

      // Handle Sounds Popover dismissal
      if (this.popover && !this.popover.classList.contains("hidden")) {
        const isInsidePopover = this.popover.contains(e.target);
        const isInsideBtn = document.getElementById("focus-soundscape-btn") && document.getElementById("focus-soundscape-btn").contains(e.target);
        const isInsideDelete = this.deletePopover && this.deletePopover.contains(e.target);

        if (!isInsidePopover && !isInsideBtn && !isInsideDelete) {
          this.closePopover();
        }
      }
    });

    // 9. Listen to iframe messages for playback state sync (Spotify & embeds)
    window.addEventListener("message", (e) => {
      // Ignore asynchronous iframe events within 1s of a manual user click to prevent state clobbering
      if (Date.now() - this.lastUserToggleTime < 1000) return;
      if (!this.activeTrack || this.activeTrack.type !== "spotify") return;

      if (e.origin && e.origin.includes("spotify.com")) {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          let isPaused = null;
          if (data && typeof data.isPaused === "boolean") {
            isPaused = data.isPaused;
          } else if (data && data.data && typeof data.data.isPaused === "boolean") {
            isPaused = data.data.isPaused;
          } else if (data && data.payload && typeof data.payload.isPaused === "boolean") {
            isPaused = data.payload.isPaused;
          }

          if (isPaused !== null) {
            const nextIsPlaying = !isPaused;
            // The Spotify embed posts state/progress messages repeatedly
            // while a track plays. If the play/pause state did not actually
            // change, do NOTHING — the previous code called renderGrid()
            // here, rebuilding every card (innerHTML = "" + recreate) on
            // every message: thumbnails flickered, scroll reset, and the
            // playing/equalizer CSS animation restarted from zero each time.
            if (nextIsPlaying === this.isPlaying) return;
            this.isPlaying = nextIsPlaying;
            this.focusManager.updateSoundscapeUi(this.isPlaying);
            if (this.popover && !this.popover.classList.contains("hidden")) {
              // Cheap in-place update: toggling two classes preserves the
              // existing DOM nodes, images, scroll position and any running
              // CSS animation. Only build the grid if it was never rendered.
              if (this.gridContainer && this.gridContainer.children && this.gridContainer.children.length > 0) {
                this.updatePlaybackStateUi();
              } else {
                this.renderGrid();
              }
            }
          }
        } catch (err) {}
      }
    });
  }

  togglePopover() {
    if (!this.popover) return;
    const isHidden = this.popover.classList.contains("hidden");
    if (isHidden) {
      this.popover.classList.remove("hidden");
      this.showView(this.currentView || "grid");
    } else {
      this.closePopover();
    }
  }

  closePopover() {
    if (this.popover) {
      this.popover.classList.add("hidden");
    }
    this.closeDeletePopover();
  }

  showView(viewName) {
    this.currentView = viewName;

    // Slide track smoothly horizontally (0%, -33.333%, -66.666%)
    if (this.sliderTrack) {
      this.sliderTrack.classList.remove("slide-view-grid", "slide-view-add", "slide-view-player");
      this.sliderTrack.classList.add("slide-view-" + viewName);
    }

    if (viewName === "grid") {
      this.renderGrid();
    } else if (viewName === "add") {
      if (this.inputSoundUrl) {
        this.inputSoundUrl.value = "";
        setTimeout(() => {
          if (this.inputSoundUrl && typeof this.inputSoundUrl.focus === "function") {
            this.inputSoundUrl.focus();
          }
        }, 80);
      }
      if (this.addStatusMsg) {
        this.addStatusMsg.textContent = "";
        this.addStatusMsg.className = "sounds-status-msg";
      }
    } else if (viewName === "player") {
      if (this.activeTrack) {
        if (this.nowPlayingHeaderThumb) {
          this.nowPlayingHeaderThumb.src = this.activeTrack.thumbnailUrl || this.activeTrack.image || "assets/focus-flow-cover.png";
          this.nowPlayingHeaderThumb.alt = this.activeTrack.title || "";
        }
        if (this.nowPlayingHeaderTitle) {
          this.nowPlayingHeaderTitle.textContent = this.activeTrack.title;
        }
        if (this.nowPlayingHeaderActions) {
          this.nowPlayingHeaderActions.classList.toggle("hidden", !this.activeTrack.isCustom);
        }

        // Only re-render embed if no iframe exists or track changed, preventing replaying current track
        const existingIframe = document.getElementById("sounds-active-iframe");
        const isAlreadyLoaded = existingIframe && existingIframe.dataset.trackId === this.activeTrack.id;
        if (!isAlreadyLoaded) {
          this.renderEmbed(this.activeTrack);
        }
      }
    }

    // Dynamic viewport height animation matching active view content
    this.updateViewportHeight(viewName);
  }

  updateViewportHeight(viewName = this.currentView) {
    if (!this.sliderViewport) return;
    let targetEl = this.viewGrid;
    if (viewName === "add") targetEl = this.viewAdd;
    else if (viewName === "player") targetEl = this.viewPlayer;

    if (targetEl) {
      requestAnimationFrame(() => {
        let h = targetEl.scrollHeight || targetEl.offsetHeight;
        if (viewName === "grid") {
          h = Math.min(Math.max(h, 320), 500);
        } else if (viewName === "add") {
          h = Math.max(h, 150);
        } else if (viewName === "player") {
          h = Math.max(h, 390);
        }
        if (h > 0) {
          this.sliderViewport.style.height = `${h}px`;
        }
      });
    }
  }

  updateNowPlayingButton(track) {
    if (!this.nowPlayingBg) return;
    const thumbUrl = (track && (track.thumbnailUrl || track.image)) || "assets/focus-flow-cover.png";
    this.nowPlayingBg.style.backgroundImage = `url("${thumbUrl}")`;
  }

  updateTopLeftCover(track) {
    if (!this.coverImg) return;
    const thumbUrl = (track && (track.thumbnailUrl || track.image)) || "assets/focus-flow-cover.png";
    this.coverImg.src = thumbUrl;
    this.coverImg.alt = track ? track.title : "Focus Flow";
  }

  renderEmbed(track) {
    if (!track || !this.embedContainer) return;

    this.embedContainer.replaceChildren();

    if (track.type === "youtube") {
      const srcUrl = `https://embedlite.com/embed/${encodeURIComponent(track.id)}?autoplay=1&controls=0&fs=0&modestbranding=1&rel=0`;

      const loadingEl = document.createElement("div");
      loadingEl.id = "sounds-embed-loading";
      loadingEl.className = "sounds-embed-loading";

      const spinner = document.createElement("div");
      spinner.className = "sounds-loading-spinner";

      const text = document.createElement("div");
      text.className = "sounds-loading-text";
      text.textContent = "Loading...";

      loadingEl.appendChild(spinner);
      loadingEl.appendChild(text);

      const iframe = document.createElement("iframe");
      iframe.id = "sounds-active-iframe";
      iframe.dataset.trackId = track.id;
      iframe.width = "100%";
      iframe.height = "320";
      iframe.src = srcUrl;
      iframe.title = track.title || "";
      iframe.frameBorder = "0";
      iframe.allow = "autoplay; picture-in-picture";
      iframe.style.opacity = "0";

      this.embedContainer.appendChild(loadingEl);
      this.embedContainer.appendChild(iframe);

      let loaded = false;
      const hideLoading = () => {
        if (loaded) return;
        loaded = true;
        loadingEl.classList.add("hidden");
        setTimeout(() => {
          if (loadingEl.parentNode) loadingEl.remove();
        }, 300);
        iframe.style.opacity = "1";
      };

      iframe.addEventListener("load", hideLoading, { once: true });
      // Fallback safety timeout in case load event takes longer or is delayed
      setTimeout(hideLoading, 3000);
    } else if (track.type === "spotify") {
      let srcUrl;
      if (track.embedUrl) {
        srcUrl = track.embedUrl;
      } else {
        srcUrl = `https://open.spotify.com/embed/playlist/${encodeURIComponent(track.id)}?utm_source=generator&theme=0`;
      }

      const loadingEl = document.createElement("div");
      loadingEl.id = "sounds-embed-loading";
      loadingEl.className = "sounds-embed-loading";

      const spinner = document.createElement("div");
      spinner.className = "sounds-loading-spinner";

      const text = document.createElement("div");
      text.className = "sounds-loading-text";
      text.textContent = "Loading...";

      loadingEl.appendChild(spinner);
      loadingEl.appendChild(text);

      const iframe = document.createElement("iframe");
      iframe.id = "sounds-active-iframe";
      iframe.dataset.trackId = track.id;
      iframe.style.borderRadius = "12px";
      iframe.style.opacity = "0";
      iframe.src = srcUrl;
      iframe.width = "100%";
      iframe.height = "352";
      iframe.frameBorder = "0";
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      iframe.allow = "autoplay; picture-in-picture";

      this.embedContainer.appendChild(loadingEl);
      this.embedContainer.appendChild(iframe);

      let loaded = false;
      const hideLoading = () => {
        if (loaded) return;
        loaded = true;
        loadingEl.classList.add("hidden");
        setTimeout(() => {
          if (loadingEl.parentNode) loadingEl.remove();
        }, 300);
        iframe.style.opacity = "1";
      };

      iframe.addEventListener("load", () => {
        hideLoading();
        setTimeout(() => {
          try {
            iframe.contentWindow.postMessage({ command: "toggle" }, "*");
          } catch (e) {}
        }, 350);
      }, { once: true });

      setTimeout(hideLoading, 3000);
    } else {
      const wrap = document.createElement("div");
      wrap.style.padding = "40px 20px";
      wrap.style.textAlign = "center";
      wrap.style.color = "rgba(255,255,255,0.7)";

      const coverImg = document.createElement("img");
      coverImg.src = "assets/focus-flow-cover.png";
      coverImg.style.width = "80px";
      coverImg.style.height = "80px";
      coverImg.style.borderRadius = "14px";
      coverImg.style.marginBottom = "14px";
      coverImg.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";

      const titleEl = document.createElement("div");
      titleEl.style.fontSize = "16px";
      titleEl.style.fontWeight = "600";
      titleEl.style.color = "#fff";
      titleEl.textContent = track.title || "";

      const subtitleEl = document.createElement("div");
      subtitleEl.style.fontSize = "13px";
      subtitleEl.style.marginTop = "6px";
      subtitleEl.style.color = "rgba(255,255,255,0.5)";
      subtitleEl.textContent = "Ambient Soundscape for Deep Focus";

      wrap.appendChild(coverImg);
      wrap.appendChild(titleEl);
      wrap.appendChild(subtitleEl);
      this.embedContainer.appendChild(wrap);
    }
  }

  async renderGrid() {
    if (!this.gridContainer) return;

    // Coalesce overlapping renders: renderGrid is async (it awaits
    // IndexedDB), so two calls in quick succession used to interleave —
    // both cleared the grid and appended duplicate cards / flickered.
    // Now a call made while one is in flight is folded into a single
    // follow-up render.
    if (this._renderGridInFlight) {
      this._renderGridQueued = true;
      return;
    }
    this._renderGridInFlight = true;
    try {
      await this._renderGridOnce();
    } finally {
      this._renderGridInFlight = false;
      if (this._renderGridQueued) {
        this._renderGridQueued = false;
        this.renderGrid();
      }
    }
  }

  async _renderGridOnce() {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        this.customSounds = await window.momentumDB.getCustomSounds();
      } catch (e) {}
    }

    this.gridContainer.innerHTML = "";

    const isSpotify = this.currentTab === "spotify";
    const defaultList = isSpotify ? this.library.spotify : this.library.youtube;
    const customList = this.customSounds.filter(s => s.type === this.currentTab);
    const combined = [...customList, ...defaultList];

    combined.forEach(track => {
      const isCurrent = this.activeTrack && this.activeTrack.id === track.id;
      const isCardPlaying = isCurrent && this.isPlaying;

      const card = document.createElement("div");
      card.className = "sound-card" + (isCurrent ? " active" : "") + (isCardPlaying ? " playing" : "");
      card.dataset.id = track.id;

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "sound-card-thumb-wrap";

      const thumbImg = document.createElement("img");
      thumbImg.className = "sound-card-thumb";
      thumbImg.src = track.thumbnailUrl || "";
      thumbImg.alt = track.title || "";
      thumbImg.loading = "lazy";

      const overlay = document.createElement("div");
      overlay.className = "sound-card-hover-overlay";

      const playIcon = document.createElement("div");
      playIcon.className = "sound-card-play-icon";
      const playSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      playSvg.setAttribute("width", "16");
      playSvg.setAttribute("height", "16");
      playSvg.setAttribute("viewBox", "0 0 24 24");
      playSvg.setAttribute("fill", "#ffffff");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", "6 4 20 12 6 20");
      playSvg.appendChild(poly);
      playIcon.appendChild(playSvg);
      overlay.appendChild(playIcon);

      thumbWrap.appendChild(thumbImg);
      thumbWrap.appendChild(overlay);

      const titleRow = document.createElement("div");
      titleRow.className = "sound-card-title-row";

      const titleSpan = document.createElement("span");
      titleSpan.className = "sound-card-title";
      titleSpan.title = track.title || "";
      titleSpan.textContent = track.title || "";
      titleRow.appendChild(titleSpan);

      if (track.isCustom) {
        const moreBtn = document.createElement("button");
        moreBtn.className = "sound-card-more-btn";
        moreBtn.dataset.trackId = track.id;
        moreBtn.title = "Options";
        const moreSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        moreSvg.setAttribute("width", "14");
        moreSvg.setAttribute("height", "14");
        moreSvg.setAttribute("viewBox", "0 0 24 24");
        moreSvg.setAttribute("fill", "currentColor");
        [5, 12, 19].forEach(cy => {
          const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("cx", "12");
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", "2");
          moreSvg.appendChild(c);
        });
        moreBtn.appendChild(moreSvg);
        titleRow.appendChild(moreBtn);
      }

      card.appendChild(thumbWrap);
      card.appendChild(titleRow);

      card.addEventListener("click", (e) => {
        if (e.target.closest(".sound-card-more-btn")) {
          e.stopPropagation();
          const moreBtn = e.target.closest(".sound-card-more-btn");
          this.openDeletePopover(track, moreBtn);
          return;
        }

        this.selectAndPlay(track);
        this.showView("player");
      });

      this.gridContainer.appendChild(card);
    });
  }

  async selectAndPlay(track) {
    const isSameTrack = this.activeTrack && this.activeTrack.id === track.id;
    const existingIframe = document.getElementById("sounds-active-iframe");
    const isAlreadyLoaded = existingIframe && existingIframe.dataset.trackId === track.id;

    this.activeTrack = track;
    this.isPlaying = true;

    if (track && track.isCustom && window.momentumDB) {
      window.momentumDB.incrementSoundPlayCount(track.id).catch(() => {});
    }

    await storageService.saveActiveSound(track);
    this.updateNowPlayingButton(track);
    this.updateTopLeftCover(track);
    this.focusManager.updateSoundscapeUi(true);

    if (track.type === "soundscape") {
      this.focusManager.soundscapePlayer.play();
    } else {
      this.focusManager.soundscapePlayer.stop();
    }

    if (!isSameTrack || !isAlreadyLoaded) {
      this.renderEmbed(track);
    } else {
      // If same track was paused, unpause without restarting from 0:00
      if (track.type === "youtube" && existingIframe && existingIframe.contentWindow) {
        try {
          existingIframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: "" }), "*");
        } catch (e) {}
      } else if (track.type === "spotify" && existingIframe && existingIframe.contentWindow) {
        try {
          existingIframe.contentWindow.postMessage({ command: "toggle" }, "*");
        } catch (e) {}
      }
    }

    this.updatePlaybackStateUi();
  }

  updatePlaybackStateUi() {
    if (!this.gridContainer) return;
    const cards = this.gridContainer.querySelectorAll(".sound-card");
    cards.forEach(card => {
      const isCurrent = this.activeTrack && card.dataset.id === this.activeTrack.id;
      const isCardPlaying = isCurrent && this.isPlaying;
      card.classList.toggle("active", Boolean(isCurrent));
      card.classList.toggle("playing", Boolean(isCardPlaying));
    });
  }

  togglePlayPause() {
    const now = Date.now();
    // Safety throttle: ignore clicks faster than 180ms to prevent spamming iframe dispatchers
    if (this.lastToggleClickTime && (now - this.lastToggleClickTime < 180)) {
      return;
    }
    this.lastToggleClickTime = now;
    this.lastUserToggleTime = now;

    this.isPlaying = !this.isPlaying;
    this.focusManager.updateSoundscapeUi(this.isPlaying);

    if (this.activeTrack) {
      const iframe = document.getElementById("sounds-active-iframe");
      const isAlreadyLoaded = iframe && iframe.dataset.trackId === this.activeTrack.id;

      if (this.activeTrack.type === "youtube") {
        if (isAlreadyLoaded && iframe.contentWindow) {
          try {
            const cmd = this.isPlaying ? "playVideo" : "pauseVideo";
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: cmd, args: "" }), "*");
          } catch (e) {}
        } else if (this.isPlaying) {
          this.renderEmbed(this.activeTrack);
        }
      } else if (this.activeTrack.type === "spotify") {
        if (isAlreadyLoaded && iframe.contentWindow) {
          try {
            if (this.isPlaying) {
              iframe.contentWindow.postMessage({ command: "toggle" }, "*");
            } else {
              iframe.contentWindow.postMessage({ command: "pause" }, "*");
            }
          } catch (e) {}
        } else if (this.isPlaying) {
          this.renderEmbed(this.activeTrack);
        }
      } else if (this.activeTrack.type === "soundscape") {
        if (this.isPlaying) {
          this.focusManager.soundscapePlayer.play();
        } else {
          this.focusManager.soundscapePlayer.stop();
        }
      }
    }

    this.updatePlaybackStateUi();
  }

  pause() {
    if (this.isPlaying) {
      this.lastUserToggleTime = Date.now();
      this.isPlaying = false;
      this.focusManager.updateSoundscapeUi(false);
      const iframe = document.getElementById("sounds-active-iframe");
      if (iframe && iframe.contentWindow) {
        if (this.activeTrack && this.activeTrack.type === "youtube") {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: "" }), "*");
          } catch (e) {}
        } else if (this.activeTrack && this.activeTrack.type === "spotify") {
          try {
            iframe.contentWindow.postMessage({ command: "pause" }, "*");
          } catch (e) {}
        }
      }
      if (this.activeTrack && this.activeTrack.type === "soundscape") {
        this.focusManager.soundscapePlayer.stop();
      }
      this.updatePlaybackStateUi();
    }
  }

  async play() {
    if (this.readyPromise) {
      try {
        await Promise.race([
          this.readyPromise,
          new Promise((resolve) => setTimeout(resolve, 2500))
        ]);
      } catch (e) {}
    }
    if (this.isPlaying) return;
    this.lastUserToggleTime = Date.now();
    this.isPlaying = true;
    this.focusManager.updateSoundscapeUi(true);

    if (this.activeTrack) {
      const iframe = document.getElementById("sounds-active-iframe");
      const isAlreadyLoaded = iframe && iframe.dataset.trackId === this.activeTrack.id;

      if (this.activeTrack.type === "youtube") {
        if (isAlreadyLoaded && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: "" }), "*");
          } catch (e) {}
        } else {
          this.renderEmbed(this.activeTrack);
        }
      } else if (this.activeTrack.type === "spotify") {
        if (isAlreadyLoaded && iframe.contentWindow) {
          try {
            iframe.contentWindow.postMessage({ command: "toggle" }, "*");
          } catch (e) {}
        } else {
          this.renderEmbed(this.activeTrack);
        }
      } else if (this.activeTrack.type === "soundscape") {
        this.focusManager.soundscapePlayer.play();
      }
    } else if (this.library && this.library.youtube && this.library.youtube.length > 0) {
      await this.playTrack(this.library.youtube[0]);
    } else {
      this.focusManager.soundscapePlayer.play();
    }

    this.updatePlaybackStateUi();
  }

  openDeletePopover(track, anchorEl) {
    this.pendingDeleteTrack = track;
    if (!this.deletePopover || !anchorEl) return;

    const rect = anchorEl.getBoundingClientRect();
    this.deletePopover.style.top = `${rect.bottom + 6}px`;
    this.deletePopover.style.left = `${rect.left - 65}px`;
    this.deletePopover.classList.remove("hidden");
  }

  closeDeletePopover() {
    this.pendingDeleteTrack = null;
    if (this.deletePopover) {
      this.deletePopover.classList.add("hidden");
    }
  }

  async confirmDelete() {
    if (!this.pendingDeleteTrack) return;
    const trackToDelete = this.pendingDeleteTrack;
    this.closeDeletePopover();

    if (window.momentumDB) {
      await window.momentumDB.deleteCustomSound(trackToDelete.id);
      this.customSounds = await window.momentumDB.getCustomSounds();
    } else {
      await storageService.deleteCustomSound(trackToDelete.id);
      this.customSounds = await storageService.getCustomSounds();
    }

    if (this.activeTrack && this.activeTrack.id === trackToDelete.id) {
      this.pause();
      const fallback = (this.library[this.currentTab] && this.library[this.currentTab][0]) || this.library.spotify[0];
      if (fallback) {
        this.activeTrack = fallback;
        this.updateNowPlayingButton(fallback);
        this.updateTopLeftCover(fallback);
        this.renderEmbed(fallback);
      }
    }

    if (this.currentView === "player" && (!this.activeTrack || this.activeTrack.id === trackToDelete.id)) {
      this.showView("grid");
    } else {
      this.renderGrid();
    }
  }

  async handleAddMusic(rawUrl) {
    if (!rawUrl || !rawUrl.trim()) return;
    const url = rawUrl.trim();

    this.showAddStatus("Adding music...", false);

    let track = null;
    try {
      if (window.momentumDB) {
        track = await window.momentumDB.addCustomSound(url);
        this.customSounds = await window.momentumDB.getCustomSounds();
      } else {
        const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
          const videoId = ytMatch[1];
          track = {
            id: videoId,
            title: "YouTube Soundscape",
            type: "youtube",
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            url: url,
            isCustom: true
          };
        } else {
          const spMatch = url.match(/spotify\.com\/(playlist|track|album)\/([a-zA-Z0-9]+)/);
          if (spMatch) {
            track = {
              id: spMatch[2],
              title: "Spotify Music",
              type: "spotify",
              thumbnailUrl: "assets/focus-flow-cover.png",
              embedUrl: `https://open.spotify.com/embed/${spMatch[1]}/${spMatch[2]}?utm_source=generator&theme=0`,
              url: url,
              isCustom: true
            };
          }
        }
        if (!track) {
          this.showAddStatus("Invalid link. Please paste a Spotify or Youtube link.", true);
          return;
        }
        await storageService.saveCustomSound(track);
        this.customSounds = await storageService.getCustomSounds();
      }
    } catch (err) {
      this.showAddStatus(err.message || "Invalid link. Please paste a Spotify or Youtube link.", true);
      return;
    }

    this.showAddStatus("Added successfully!", false);
    setTimeout(() => {
      this.currentTab = track.type;
      if (this.currentTab === "spotify") {
        if (this.tabSpotify) this.tabSpotify.classList.add("active");
        if (this.tabYoutube) this.tabYoutube.classList.remove("active");
      } else {
        if (this.tabYoutube) this.tabYoutube.classList.add("active");
        if (this.tabSpotify) this.tabSpotify.classList.remove("active");
      }
      this.selectAndPlay(track);
      this.showView("player");
    }, 500);
  }

  showAddStatus(msg, isError) {
    if (!this.addStatusMsg) return;
    this.addStatusMsg.textContent = msg;
    this.addStatusMsg.className = "sounds-status-msg " + (isError ? "error" : "success");
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

class FocusManager {
  constructor() {
    this.topFocusBtn = null;
    this.focusPopover = null;

    // Fullscreen Focus Mode Elements
    this.clockView = null;
    this.fullscreenView = null;
    this.fsTopLeft = null;
    this.fsTopRight = null;
    this.topStatusEl = null;
    this.topStatusLabel = null;
    this.stopBtn = null;
    this.fsTabFocus = null;
    this.fsTabBreak = null;
    this.fsArcFill = null;
    this.fsTimeEl = null;
    this.fsTaskInput = null;
    this.fsPlayBtn = null;
    this.fsIconPause = null;
    this.fsIconPlay = null;
    this.durationPicker = null;
    this.soundscapeBtn = null;
    this.soundscapePauseIcon = null;
    this.soundscapePlayIcon = null;
    this.fsCalendarBtn = null;
    this.fsFullscreenBtn = null;
    this.fsTodayTimeEl = null;
    this.quoteContainer = null;

    // Popover elements
    this.timerDisplayEl = null;
    this.modeBadgeEl = null;
    this.startBtn = null;
    this.pauseBtn = null;
    this.resumeBtn = null;
    this.resetBtn = null;
    this.skipBtn = null;

    this.localTickInterval = null;
    this.soundscapePlayer = new SoundscapePlayer();
    this.chimePlayer = new ChimePlayer();
    this.soundsManager = null;
    this.selectedFocusDuration = 120; // 2 hours default
    this.isFocusModeOpen = false;
    this.isTransitioning = false;
    this.taskSaveTimeout = null;

    // Cinematic Transition Elements
    this.transitionOverlay = null;
    this.ftoPhrase = null;
    this.bgLayer = null;

    this.extApi = (typeof browser !== "undefined") ? browser : (typeof chrome !== "undefined" ? chrome : null);
  }

  async init(elements) {
    // Normal Top Focus trigger
    this.topFocusBtn = document.getElementById("btn-toggle-focus");
    this.focusPopover = document.getElementById("focus-popover");

    // Cinematic Transition Elements
    this.transitionOverlay = document.getElementById("focus-transition-overlay");
    this.ftoPhrase = document.getElementById("fto-phrase");
    this.bgLayer = document.getElementById("background-layer");

    // Fullscreen Focus View Elements
    this.clockView = document.getElementById("dashboard-clock-view");
    this.fullscreenView = document.getElementById("focus-fullscreen-view");
    this.fsTopLeft = document.getElementById("focus-fs-top-left");
    this.topStatusEl = document.getElementById("focus-top-status");
    this.topStatusLabel = document.getElementById("focus-top-status-label");
    this.stopBtn = document.getElementById("focus-btn-stop");

    this.fsTabFocus = document.getElementById("focus-tab-focus");
    this.fsTabBreak = document.getElementById("focus-tab-break");
    this.fsArcFill = document.getElementById("focus-fs-arc-fill");
    this.fsTimeEl = document.getElementById("focus-fs-time");
    this.fsTaskInput = document.getElementById("focus-fs-task-input");
    this.fsPlayBtn = document.getElementById("focus-fs-play-btn");
    this.fsIconPause = document.getElementById("focus-icon-pause");
    this.fsIconPlay = document.getElementById("focus-icon-play");
    this.durationPicker = document.getElementById("focus-duration-picker");

    this.soundscapeBtn = document.getElementById("focus-soundscape-btn");
    this.soundscapePauseIcon = document.getElementById("soundscape-icon-pause");
    this.soundscapePlayIcon = document.getElementById("soundscape-icon-play");

    this.fsCalendarBtn = document.getElementById("focus-fs-btn-calendar");
    this.fsFullscreenBtn = document.getElementById("focus-fs-btn-fullscreen");

    this.quoteContainer = document.getElementById("dashboard-quote-container");

    // Mini Popover elements (fallback / legacy)
    this.timerDisplayEl = elements.timerDisplay;
    this.modeBadgeEl = elements.modeBadge;
    this.startBtn = elements.startBtn;
    this.pauseBtn = elements.pauseBtn;
    this.resumeBtn = elements.resumeBtn;
    this.resetBtn = elements.resetBtn;
    this.skipBtn = elements.skipBtn;

    this.chimePlayer = new ChimePlayer();
    this.soundsManager = new SoundsManager(this);

    this.bindEvents();
    this.setupStorageListener();

    // Fast-path: immediately initialize from synchronous cache (0ms delay)
    const cachedSettings = storageService.getSettingsSync();
    const cachedState = storageService.getFocusStateSync();
    if (cachedSettings.focusModeActive) {
      this.openFullscreenFocus(true, false);
      const defaultFocusMins = cachedSettings.focusDuration || 120;
      const defaultBreakMins = cachedSettings.breakDuration || 5;
      let initSeconds = (!cachedState.isRunning && cachedSettings.focusDuration)
        ? cachedSettings.focusDuration * 60
        : (cachedState.remainingSeconds || defaultFocusMins * 60);

      if (cachedState.currentTab === "break") {
        initSeconds = (!cachedState.breakIsRunning && cachedSettings.breakDuration)
          ? cachedSettings.breakDuration * 60
          : (cachedState.breakRemainingSeconds || defaultBreakMins * 60);
        if (cachedState.breakIsRunning && cachedState.breakTargetTimestamp) {
          // Cap at the break duration (first 5s are the start chime).
          initSeconds = Math.min(defaultBreakMins * 60, Math.max(0, Math.round((cachedState.breakTargetTimestamp - Date.now()) / 1000)));
        }
      } else if (cachedState.isRunning && cachedState.targetTimestamp) {
        initSeconds = Math.max(0, Math.round((cachedState.targetTimestamp - Date.now()) / 1000));
      }
      this.updateDisplay(initSeconds, cachedState, cachedSettings);
    }

    // Async hydration: reconcile with persistent background storage
    const settings = await storageService.getSettings();
    let state = await storageService.getFocusState();

    if (settings.focusModeActive) {
      this.openFullscreenFocus(true, false);
    }

    if (this.soundsManager.readyPromise) {
      // Never let a slow/hung sounds library load block the first
      // render: the popover re-renders itself once loading finishes,
      // and play() re-awaits the same promise (also with a ceiling).
      await Promise.race([
        this.soundsManager.readyPromise,
        new Promise((resolve) => setTimeout(resolve, 2500))
      ]);
    }

    await this.render();
  }

  bindEvents() {
    // 1. Top-left Focus button -> OPENS FULLSCREEN FOCUS MODE (Cinematic flight transition)
    if (this.topFocusBtn) {
      this.topFocusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openFullscreenFocus(false, true);
      });
    }

    // 2. Stop Button (■) -> Stops timer and exits to Home
    if (this.stopBtn) {
      this.stopBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.stopAndExitFocus();
      });
    }

    // 3. Focusing Status Pill -> Exits Focus mode, stops timer and returns to Home
    if (this.topStatusEl) {
      this.topStatusEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.stopAndExitFocus();
      });
    }

    // 4. Escape Key -> Exits Focus mode, stops timer and returns to Home
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isFocusModeOpen) {
        if (this.durationPicker && !this.durationPicker.classList.contains("hidden")) {
          this.durationPicker.classList.add("hidden");
          return;
        }
        if (document.activeElement === this.fsTaskInput) {
          this.fsTaskInput.blur();
          return;
        }
        this.stopAndExitFocus();
      }
    });

    // 5. Play / Pause circular button in center
    if (this.fsPlayBtn) {
      this.fsPlayBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const state = await storageService.getFocusState();
        if (state.isRunning) {
          await this.pauseTimer();
        } else {
          await this.startFocus();
        }
      });
    }

    // 6. FOCUS and BREAK Mode Tabs
    if (this.fsTabFocus) {
      this.fsTabFocus.addEventListener("click", async (e) => {
        e.stopPropagation();
        const state = await storageService.getFocusState();
        if (state.currentTab === "break" || state.breakIsRunning) {
          await this.finishBreak();
        } else {
          await this.switchTab("focus");
        }
      });
    }

    // 7. Background message listener for alarm events (e.g. Break timer finish)
    if (this.extApi && this.extApi.runtime && this.extApi.runtime.onMessage) {
      this.extApi.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === "BREAK_COMPLETED_ALARM") {
          // No chime here: the page already chimed at break start and
          // during the break's final 5 seconds. This path only needs to
          // resume music and re-sync the UI.
          if (this.soundsManager) {
            this.soundsManager.play();
          }
          this.render();
        }
      });
    }

    if (this.fsTabBreak) {
      this.fsTabBreak.addEventListener("click", async (e) => {
        e.stopPropagation();
        const state = await storageService.getFocusState();
        const settings = (typeof window !== "undefined" && window.momentumDB)
          ? await window.momentumDB.getSettings()
          : await storageService.getSettings();
        const intervalMins = settings && settings.focusInterval ? settings.focusInterval : 60;

        if (!state.breakUnlocked && !state.breakIsRunning) {
          const continuousSecs = state.continuousFocusSeconds || 0;
          const minsRun = Math.floor(continuousSecs / 60);
          const remMins = Math.max(1, intervalMins - minsRun);
          this.fsTabBreak.setAttribute("title", `Focus continuously for ${this.formatIntervalDuration(intervalMins)} to unlock Break (${remMins}m remaining)`);
          return;
        }
        await this.startBreak();
      });
    }

    // 7. Big Time click -> Toggle Duration Presets Picker
    if (this.fsTimeEl && this.durationPicker) {
      this.fsTimeEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.durationPicker.classList.toggle("hidden");
      });

      // Handle preset clicks (25m, 50m, 90m, 600m / 10h)
      const presetBtns = this.durationPicker.querySelectorAll(".focus-duration-btn");
      presetBtns.forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const mins = parseInt(btn.dataset.mins, 10) || 600;
          this.selectedFocusDuration = mins;
          this.durationPicker.classList.add("hidden");
          await this.startFocus(mins);
        });
      });

      // Close duration picker when clicking outside
      document.addEventListener("click", (e) => {
        if (this.durationPicker && !this.durationPicker.contains(e.target) && e.target !== this.fsTimeEl) {
          this.durationPicker.classList.add("hidden");
        }
      });
    }

    // 8. Task intention input auto-save
    if (this.fsTaskInput) {
      this.fsTaskInput.addEventListener("input", () => {
        clearTimeout(this.taskSaveTimeout);
        this.taskSaveTimeout = setTimeout(() => {
          this.saveCurrentTask(this.fsTaskInput.value);
        }, 300);
      });

      this.fsTaskInput.addEventListener("change", () => {
        this.saveCurrentTask(this.fsTaskInput.value);
      });
    }

    // 9. Ambient Soundscape ("Focus Flow") & Sounds Popover Trigger
    if (this.soundscapeBtn) {
      const playDisc = this.soundscapeBtn.querySelector(".soundscape-play-disc");
      if (playDisc) {
        playDisc.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (this.soundsManager) {
            this.soundsManager.togglePlayPause();
          } else {
            const playing = this.soundscapePlayer.toggle();
            this.updateSoundscapeUi(playing);
          }
        });
      }

      this.soundscapeBtn.addEventListener("click", (e) => {
        // If clicking directly on the play disc, it is handled by playDisc listener
        if (e.target.closest(".soundscape-play-disc")) {
          return;
        }

        e.stopPropagation();
        // If clicking album cover or body, toggle Sounds Popover
        if (this.soundsManager) {
          this.soundsManager.togglePopover();
        }
      });
    }

    // 10. Fullscreen Toggle Button
    if (this.fsFullscreenBtn) {
      this.fsFullscreenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // 11. Legacy popover actions
    if (this.startBtn) {
      this.startBtn.addEventListener("click", () => this.startFocus());
    }
    if (this.pauseBtn) {
      this.pauseBtn.addEventListener("click", () => this.pauseTimer());
    }
    if (this.resumeBtn) {
      this.resumeBtn.addEventListener("click", () => this.resumeTimer());
    }
    if (this.resetBtn) {
      this.resetBtn.addEventListener("click", () => this.resetTimer());
    }
    if (this.skipBtn) {
      this.skipBtn.addEventListener("click", () => this.skipTimer());
    }
  }

  updateSoundscapeUi(isPlaying) {
    if (this.soundscapePauseIcon && this.soundscapePlayIcon) {
      this.soundscapePauseIcon.classList.toggle("hidden", !isPlaying);
      this.soundscapePlayIcon.classList.toggle("hidden", isPlaying);
    }
  }

  async saveCurrentTask(taskText) {
    this.sendMessage({
      type: "UPDATE_FOCUS_TASK",
      task: taskText
    });
  }

  // --- Fullscreen Focus Mode Transition Logic ---
  async openFullscreenFocus(skipAnimation = false, autoStartIfIdle = true) {
    if (this.isTransitioning && !skipAnimation) return;
    this.isTransitioning = false;

    if (skipAnimation) {
      this.isFocusModeOpen = true;
      if (this.bgLayer) this.bgLayer.classList.add("bg-zoomed");
      document.documentElement.classList.add("focus-mode-active");
      document.body.classList.add("focus-mode-active");

      try {
        const cachedSettings = JSON.parse(localStorage.getItem("momentum_cache_settings") || "{}");
        cachedSettings.focusModeActive = true;
        localStorage.setItem("momentum_cache_settings", JSON.stringify(cachedSettings));
      } catch (e) {}
      await storageService.setSetting("focusModeActive", true);

      const state = await storageService.getFocusState();
      if (autoStartIfIdle && (!state.isRunning || state.mode === "idle")) {
        await this.startFocus();
      } else {
        if (state.currentTab !== "break" && this.soundsManager && !this.soundsManager.isPlaying) {
          this.soundsManager.play();
        }
        await this.render();
      }
      return;
    }

    await this.animateEnterFocus(autoStartIfIdle);
  }

  async animateEnterFocus(autoStartIfIdle = true) {
    this.isTransitioning = true;
    this.isFocusModeOpen = true;

    try {
      // Pick a random inspirational phrase (5-8 words)
      const phrase = ENTER_FOCUS_PHRASES[Math.floor(Math.random() * ENTER_FOCUS_PHRASES.length)];

      // Initialize phrase overlay
      if (this.transitionOverlay && this.ftoPhrase) {
        this.ftoPhrase.textContent = phrase;
        this.ftoPhrase.className = "fto-phrase";
        this.transitionOverlay.classList.remove("hidden");
      }

      // Phase 1: Clear Home screen and start background zoom (0ms - 350ms)
      document.documentElement.classList.add("transitioning-to-focus");
      if (this.bgLayer) this.bgLayer.classList.add("bg-zoomed");

      // Position the REAL top-center label at screen center, initially hidden
      if (this.topStatusLabel) {
        this.topStatusLabel.style.transition = "none";
        this.topStatusLabel.style.transform = "none";
        this.topStatusLabel.style.opacity = "0";

        const rect = this.topStatusLabel.getBoundingClientRect();
        const labelCenterX = rect.left + rect.width / 2;
        const labelCenterY = rect.top + rect.height / 2;
        const startX = (window.innerWidth / 2) - labelCenterX;
        const startY = (window.innerHeight / 2) - labelCenterY;

        // Calculate exact scale factor so "Focusing" matches the font-size of the initial phrase
        let targetScale = 2.1;
        if (this.ftoPhrase && window.getComputedStyle) {
          const phraseSize = parseFloat(window.getComputedStyle(this.ftoPhrase).fontSize);
          const labelSize = parseFloat(window.getComputedStyle(this.topStatusLabel).fontSize);
          if (phraseSize > 0 && labelSize > 0) {
            targetScale = phraseSize / labelSize;
          }
        }

        this.topStatusLabel.style.transform = `translate(${startX.toFixed(1)}px, ${startY.toFixed(1)}px) scale(${targetScale.toFixed(3)})`;
        this.topStatusLabel.style.filter = "blur(6px)";
        this.topStatusLabel.style.opacity = "0";
      }

      // Wait only 350ms until Home UI clears, so phrase appears while background is actively zooming
      await new Promise((r) => setTimeout(r, 350));

      // Phase 2: Inspirational phrase fades in at center while background continuously zooms (350ms - 2150ms)
      if (this.ftoPhrase) {
        this.ftoPhrase.classList.add("visible");
      }
      await new Promise((r) => setTimeout(r, 1800));

      // Phase 3: Cross-fade phrase to "Focusing" at center while background zooms (2150ms - 3550ms)
      if (this.ftoPhrase) {
        this.ftoPhrase.classList.remove("visible");
        this.ftoPhrase.classList.add("fade-out");
      }
      if (this.topStatusLabel) {
        this.topStatusLabel.style.transition = "opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1), filter 1.2s ease";
        this.topStatusLabel.style.opacity = "1";
        this.topStatusLabel.style.filter = "blur(0px)";
      }
      await new Promise((r) => setTimeout(r, 1400));

      // Hold "Focusing" at center briefly (3550ms - 4150ms)
      await new Promise((r) => setTimeout(r, 600));

      // Phase 4: The REAL "Focusing" label smoothly flies to top-center (4150ms - 5350ms)
      if (this.topStatusLabel) {
        this.topStatusLabel.style.transition = "transform 1.2s cubic-bezier(0.22, 1, 0.36, 1)";
        this.topStatusLabel.style.transform = "translate(0px, 0px) scale(1)";
      }
      await new Promise((r) => setTimeout(r, 1200));

      // Phase 5: Reveal Focus Mode UI completely as background completes its zoom (5350ms - 6000ms)
      document.documentElement.classList.add("focus-mode-active");
      document.body.classList.add("focus-mode-active");
      document.documentElement.classList.remove("transitioning-to-focus");

      // Clean up temporary inline styles on the label
      if (this.topStatusLabel) {
        this.topStatusLabel.style.transition = "";
        this.topStatusLabel.style.transform = "";
        this.topStatusLabel.style.opacity = "";
        this.topStatusLabel.style.filter = "";
      }

      try {
        const cachedSettings = JSON.parse(localStorage.getItem("momentum_cache_settings") || "{}");
        cachedSettings.focusModeActive = true;
        localStorage.setItem("momentum_cache_settings", JSON.stringify(cachedSettings));
      } catch (e) {}
      await storageService.setSetting("focusModeActive", true);

      const state = await storageService.getFocusState();
      if (autoStartIfIdle && (!state.isRunning || state.mode === "idle")) {
        await this.startFocus();
      } else {
        if (state.currentTab !== "break" && this.soundsManager && !this.soundsManager.isPlaying) {
          this.soundsManager.play();
        }
        await this.render();
      }
    } catch (err) {
      console.warn("animateEnterFocus warning:", err);
    } finally {
      await new Promise((r) => setTimeout(r, 650));
      // Cleanup transition overlay
      if (this.transitionOverlay && this.ftoPhrase) {
        this.ftoPhrase.className = "fto-phrase";
        this.transitionOverlay.classList.add("hidden");
      }
      this.isTransitioning = false;
    }
  }

  async stopAndExitFocus() {
    this.isTransitioning = false;
    await this.animateExitFocus();
  }

  async animateExitFocus() {
    this.isTransitioning = true;
    this.isFocusModeOpen = false;

    if (this.durationPicker) this.durationPicker.classList.add("hidden");

    // Immediately stop local timer ticking so time does not change
    if (this.localTickInterval) {
      clearInterval(this.localTickInterval);
      this.localTickInterval = null;
    }

    // Stop ambient sound & music player
    this.soundscapePlayer.stop();
    if (this.soundsManager) {
      this.soundsManager.pause();
    }
    this.updateSoundscapeUi(false);

    try {
      const cachedSettings = JSON.parse(localStorage.getItem("momentum_cache_settings") || "{}");
      cachedSettings.focusModeActive = false;
      localStorage.setItem("momentum_cache_settings", JSON.stringify(cachedSettings));
    } catch (e) {}
    await storageService.setSetting("focusModeActive", false);

    // Stop and pause the timer completely in background
    await this.pauseTimer();

    try {
      // Pick a random exit phrase (5-8 words)
      const phrase = EXIT_FOCUS_PHRASES[Math.floor(Math.random() * EXIT_FOCUS_PHRASES.length)];

      // Initialize overlay elements
      if (this.transitionOverlay && this.ftoPhrase) {
        this.ftoPhrase.textContent = phrase;
        this.ftoPhrase.className = "fto-phrase";
        this.transitionOverlay.classList.remove("hidden");
      }

      // Phase 1: Clear Focus UI and start slow background unzoom (0ms - 350ms)
      document.documentElement.classList.add("transitioning-to-home");
      document.documentElement.classList.remove("focus-mode-active");
      document.body.classList.remove("focus-mode-active");
      if (this.bgLayer) this.bgLayer.classList.remove("bg-zoomed");
      await new Promise((r) => setTimeout(r, 350));

      // Phase 2: Exit phrase fades in while background continuously unzooms (350ms - 2150ms)
      if (this.ftoPhrase) {
        this.ftoPhrase.classList.add("visible");
      }
      await new Promise((r) => setTimeout(r, 1800));

      // Phase 3: Exit phrase fades out slowly (2150ms - 3350ms)
      if (this.ftoPhrase) {
        this.ftoPhrase.classList.remove("visible");
        this.ftoPhrase.classList.add("fade-out");
      }
      await new Promise((r) => setTimeout(r, 1200));

      // Phase 4: Reveal Home Dashboard with smooth cinematic entrance animation (3350ms - 4450ms)
      document.documentElement.classList.remove("transitioning-to-home");
      document.documentElement.classList.add("revealing-home-content");
      await new Promise((r) => setTimeout(r, 1100));
      document.documentElement.classList.remove("revealing-home-content");
    } catch (err) {
      console.warn("animateExitFocus warning:", err);
      document.documentElement.classList.remove("transitioning-to-home", "focus-mode-active");
      document.body.classList.remove("focus-mode-active");
      if (this.bgLayer) this.bgLayer.classList.remove("bg-zoomed");
    } finally {
      // Cleanup transition overlay
      if (this.transitionOverlay && this.ftoPhrase) {
        this.ftoPhrase.className = "fto-phrase";
        this.transitionOverlay.classList.add("hidden");
      }
      this.isTransitioning = false;
    }
  }

  closePopover() {
    if (this.focusPopover) {
      this.focusPopover.classList.add("hidden");
    }
    if (this.topFocusBtn) {
      this.topFocusBtn.classList.remove("active");
    }
  }

  setupStorageListener() {
    if (this.extApi && this.extApi.storage && this.extApi.storage.onChanged) {
      this.extApi.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes.focus_state || changes.settings || changes.focus_stats)) {
          this.render();
        }
      });
    }
  }

  async startFocus(customMinutes) {
    const state = await storageService.getFocusState();
    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();
    const defaultDuration = (settings && settings.focusDuration) ? settings.focusDuration : 120;
    const duration = customMinutes || (settings && settings.focusDuration ? settings.focusDuration : (state.durationMinutes || defaultDuration));
    const taskText = (this.fsTaskInput && this.fsTaskInput.value.trim()) || state.currentTask || "";
    let remaining = duration * 60;
    if (state.remainingSeconds && !customMinutes && state.durationMinutes === duration) {
      remaining = state.remainingSeconds;
    }
    const targetTimestamp = Date.now() + remaining * 1000;

    const runningState = {
      ...state,
      mode: "focus",
      isRunning: true,
      durationMinutes: duration,
      remainingSeconds: remaining,
      targetTimestamp: targetTimestamp,
      sessionStartTime: Date.now(),
      currentTask: taskText
    };

    // Synchronously update localStorage cache immediately (0ms)
    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(runningState));
    } catch (e) {}

    await storageService.saveFocusState(runningState);
    this.sendExtMessage({
      type: "START_FOCUS",
      duration: duration,
      task: taskText
    }).catch(() => {});

    // Auto-start music when focus starts
    if (this.soundsManager) {
      this.soundsManager.play();
    }

    await this.render();
  }

  async startBreak() {
    const state = await storageService.getFocusState();

    // Idempotent: a break that is already running must never be restarted.
    // The render() tick used to re-enter startBreak() every cycle because
    // breakUnlocked was only flipped on the tick's private copy of the
    // state (never persisted) while the continuous-focus streak kept
    // growing past the unlock interval — each re-entry pushed
    // breakTargetTimestamp forward, so the break countdown appeared
    // frozen at its full duration and never finished.
    if (state.breakIsRunning && state.currentTab === "break") {
      await this.render();
      return;
    }

    // 1. Turn off music immediately
    if (this.soundsManager) {
      this.soundsManager.pause();
    }
    if (this.soundscapePlayer) {
      this.soundscapePlayer.stop();
    }

    // 2. Notification chime for 5 seconds. The break countdown only
    // starts when the chime stops: breakTargetTimestamp therefore points
    // 5s (announcement) + breakDuration into the future, and the display
    // layer caps the shown remaining time at the break duration.
    if (this.chimePlayer) {
      this.chimePlayer.playChimeSequence(5000);
    }

    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();
    const breakDuration = (settings && settings.breakDuration) ? settings.breakDuration : 5;
    const breakAnnounceUntil = Date.now() + 5000;
    const breakTargetTimestamp = breakAnnounceUntil + breakDuration * 60 * 1000;

    // The focus timer keeps running while the break runs.
    let focusTarget = state.targetTimestamp;
    let isFocusRunning = state.isRunning;
    let sessionStart = state.sessionStartTime;

    if (!isFocusRunning) {
      const defaultDuration = (settings && settings.focusDuration) ? settings.focusDuration : 120;
      const remaining = (typeof state.remainingSeconds === "number" && state.remainingSeconds > 0)
        ? state.remainingSeconds
        : defaultDuration * 60;
      focusTarget = Date.now() + remaining * 1000;
      isFocusRunning = true;
      sessionStart = Date.now();
    }

    const breakState = {
      ...state,
      currentTab: "break",
      breakUnlocked: true,
      breakIsRunning: true,
      breakRemainingSeconds: breakDuration * 60,
      breakTargetTimestamp: breakTargetTimestamp,
      breakAnnounceUntil: breakAnnounceUntil,
      breakEndChimePlayed: false,
      isRunning: isFocusRunning,
      targetTimestamp: focusTarget,
      sessionStartTime: sessionStart
    };

    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(breakState));
    } catch (e) {}

    await storageService.saveFocusState(breakState);
    this.sendExtMessage({
      type: "START_BREAK",
      breakTargetTimestamp: breakTargetTimestamp,
      breakAnnounceUntil: breakAnnounceUntil
    }).catch(() => {});
    await this.render();
  }

  async finishBreak() {
    // No chime here anymore: the warning chime already plays during the
    // final 5 seconds of the break (see the render() tick), so the break
    // ends right as that chime fades out.
    const state = await storageService.getFocusState();
    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();
    const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
    const finishedBreakState = {
      ...state,
      currentTab: "focus",
      breakIsRunning: false,
      breakRemainingSeconds: breakSecs,
      breakUnlocked: false,
      breakAnnounceUntil: null,
      breakEndChimePlayed: false,
      continuousFocusSeconds: 0,
      lastContinuousBase: 0
    };

    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(finishedBreakState));
    } catch (e) {}

    await storageService.saveFocusState(finishedBreakState);
    this.sendExtMessage({ type: "FINISH_BREAK" }).catch(() => {});

    // 2. Resume / restart focus music playback!
    if (this.soundsManager) {
      this.soundsManager.play();
    }
    await this.render();
  }

  async switchTab(tab) {
    const state = await storageService.getFocusState();
    if (tab === "break" && !state.breakUnlocked && !state.breakIsRunning) {
      return;
    }
    const updatedState = { ...state, currentTab: tab };
    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(updatedState));
    } catch (e) {}
    await storageService.saveFocusState(updatedState);
    this.sendExtMessage({ type: "SWITCH_TAB", tab: tab }).catch(() => {});
    await this.render();
  }

  async pauseTimer() {
    // 1. Immediately kill local tick interval
    if (this.localTickInterval) {
      clearInterval(this.localTickInterval);
      this.localTickInterval = null;
    }

    // Pause music playback when timer is paused
    if (this.soundsManager) {
      this.soundsManager.pause();
    }
    if (this.soundscapePlayer) {
      this.soundscapePlayer.stop();
    }

    // 2. Fetch state and compute exact remaining & continuous seconds
    const state = await storageService.getFocusState();
    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();
    const intervalSecs = (settings && settings.focusInterval ? settings.focusInterval : 60) * 60;
    const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
    const targetTotalSecs = (settings && settings.focusDuration ? settings.focusDuration : 120) * 60;

    const now = Date.now();
    let remaining = state.remainingSeconds || (state.durationMinutes * 60);
    if (state.isRunning && state.targetTimestamp) {
      remaining = Math.max(0, Math.round((state.targetTimestamp - now) / 1000));
    }

    let continuous = state.continuousFocusSeconds || 0;
    if (state.sessionStartTime) {
      const streak = Math.max(0, Math.round((now - state.sessionStartTime) / 1000));
      continuous = (state.lastContinuousBase || 0) + streak;
    }
    const breakUnlocked = (continuous >= intervalSecs) || Boolean(state.breakUnlocked);

    let breakRemaining = state.breakRemainingSeconds || breakSecs;
    if (state.breakIsRunning && state.breakTargetTimestamp) {
      breakRemaining = Math.max(0, Math.round((state.breakTargetTimestamp - now) / 1000));
      // Cap at the break duration (first 5s are the start chime).
      breakRemaining = Math.min(breakRemaining, breakSecs);
    }

    const totalSecsToday = Math.max(0, targetTotalSecs - remaining);

    // 3. Create paused state
    const pausedState = {
      ...state,
      isRunning: false,
      remainingSeconds: remaining,
      targetTimestamp: null,
      sessionStartTime: null,
      continuousFocusSeconds: continuous,
      lastContinuousBase: continuous,
      breakUnlocked: breakUnlocked,
      breakRemainingSeconds: breakRemaining,
      breakIsRunning: false,
      breakTargetTimestamp: null
    };

    // 4. Synchronously update localStorage cache (0ms)
    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(pausedState));
    } catch (e) {}

    // 5. Save state and sync today focus stats
    await storageService.syncTodayFocusSeconds(totalSecsToday, state.currentTask);
    await storageService.saveFocusState(pausedState);

    // 6. Notify background to clear alarms and record session
    this.sendExtMessage({ type: "PAUSE_TIMER" }).catch(() => {});

    // 7. Update display
    const displaySecs = (pausedState.currentTab === "break") ? breakRemaining : remaining;
    this.updateDisplay(displaySecs, pausedState);
    this.updateButtons(pausedState);
    this.updateTopButtonState(pausedState, displaySecs);
  }

  async resumeTimer() {
    await this.startFocus();
  }

  async resetTimer() {
    if (this.localTickInterval) {
      clearInterval(this.localTickInterval);
      this.localTickInterval = null;
    }
    const state = await storageService.getFocusState();
    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();
    const targetTotalSecs = (settings && settings.focusDuration ? settings.focusDuration : 120) * 60;
    const now = Date.now();
    let remaining = state.remainingSeconds;
    if (state.isRunning && state.targetTimestamp) {
      remaining = Math.max(0, Math.round((state.targetTimestamp - now) / 1000));
    }
    const totalSecsToday = Math.max(0, targetTotalSecs - remaining);
    await storageService.syncTodayFocusSeconds(totalSecsToday, state.currentTask);

    const resetState = {
      ...state,
      isRunning: false,
      remainingSeconds: remaining,
      targetTimestamp: null,
      sessionStartTime: null,
      breakIsRunning: false,
      breakTargetTimestamp: null
    };

    try {
      localStorage.setItem("momentum_cache_focus_state", JSON.stringify(resetState));
    } catch (e) {}

    await storageService.saveFocusState(resetState);
    this.sendExtMessage({ type: "RESET_TIMER" }).catch(() => {});
    await this.render();
  }

  async skipTimer() {
    await this.pauseTimer();
  }

  async sendExtMessage(msg) {
    try {
      // 1. Firefox native browser.* API returns a Promise directly
      if (typeof browser !== "undefined" && browser.runtime && typeof browser.runtime.sendMessage === "function") {
        const msgPromise = browser.runtime.sendMessage(msg);
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
        return await Promise.race([msgPromise, timeoutPromise]);
      }

      // 2. Chromium chrome.* API uses callbacks or Promise with 1s timeout
      if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
        return await new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
          }, 1000);

          try {
            chrome.runtime.sendMessage(msg, (res) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve(res || null);
              }
            });
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(null);
            }
          }
        });
      }
    } catch (err) {
      console.warn("sendExtMessage error:", err);
    }
    return null;
  }

  async sendMessage(msg) {
    const res = await this.sendExtMessage(msg);
    await this.render();
    return res;
  }

  async render() {
    const state = await storageService.getFocusState();
    const settings = (typeof window !== "undefined" && window.momentumDB)
      ? await window.momentumDB.getSettings()
      : await storageService.getSettings();

    const intervalSecs = (settings && settings.focusInterval ? settings.focusInterval : 60) * 60;
    const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
    const targetTotalSecs = (settings && settings.focusDuration ? settings.focusDuration : 120) * 60;

    // Clear local tick interval
    if (this.localTickInterval) {
      clearInterval(this.localTickInterval);
      this.localTickInterval = null;
    }

    let focusSeconds = state.remainingSeconds || (state.durationMinutes * 60);
    if (!state.isRunning && settings && settings.focusDuration && (state.durationMinutes !== settings.focusDuration || state.remainingSeconds > targetTotalSecs)) {
      state.durationMinutes = settings.focusDuration;
      state.remainingSeconds = targetTotalSecs;
      focusSeconds = targetTotalSecs;
      await storageService.saveFocusState({
        durationMinutes: settings.focusDuration,
        remainingSeconds: targetTotalSecs
      });
    } else if (state.isRunning && state.targetTimestamp) {
      focusSeconds = Math.max(0, Math.round((state.targetTimestamp - Date.now()) / 1000));
    }

    let breakSeconds = state.breakRemainingSeconds || breakSecs;
    if (!state.breakIsRunning && settings && settings.breakDuration && (!state.breakRemainingSeconds || state.breakRemainingSeconds !== breakSecs)) {
      state.breakRemainingSeconds = breakSecs;
      breakSeconds = breakSecs;
    } else if (state.breakIsRunning && state.breakTargetTimestamp) {
      breakSeconds = Math.max(0, Math.round((state.breakTargetTimestamp - Date.now()) / 1000));
      // During the 5s start-of-break chime the raw remaining time is up
      // to 5s above the break duration; the countdown visually starts
      // (at the full duration) only once the chime stops.
      breakSeconds = Math.min(breakSeconds, breakSecs);
    }

    let tickCount = 0;

    // Start local ticking ONLY if focus mode is open AND either focus or break is running!
    if ((state.isRunning || state.breakIsRunning) && this.isFocusModeOpen) {
      this.localTickInterval = setInterval(() => {
        const now = Date.now();
        tickCount++;

        if (state.isRunning && state.targetTimestamp) {
          focusSeconds = Math.max(0, Math.round((state.targetTimestamp - now) / 1000));
          state.remainingSeconds = focusSeconds;

          // Compute continuous focus
          const elapsedStreak = Math.max(0, Math.round((now - (state.sessionStartTime || now)) / 1000));
          const continuous = (state.lastContinuousBase || 0) + elapsedStreak;
          state.continuousFocusSeconds = continuous;
          // Never auto-start a break while one is already running: the
          // focus timer keeps running during the break, so the streak
          // stays above the unlock interval for the whole break.
          if (continuous >= intervalSecs && !state.breakUnlocked && !state.breakIsRunning && state.currentTab !== "break") {
            state.breakUnlocked = true;
            this.startBreak();
            return;
          }
        }

        if (state.breakIsRunning && state.breakTargetTimestamp) {
          breakSeconds = Math.max(0, Math.round((state.breakTargetTimestamp - now) / 1000));
          // Cap at the break duration: the first 5s are the start chime.
          breakSeconds = Math.min(breakSeconds, breakSecs);
          state.breakRemainingSeconds = breakSeconds;
          // Warning chime for the final 5 seconds of the break (once).
          if (breakSeconds <= 5 && breakSeconds > 0 && !state.breakEndChimePlayed) {
            state.breakEndChimePlayed = true;
            if (this.chimePlayer) {
              this.chimePlayer.playChimeSequence(5000);
            }
            storageService.saveFocusState({ breakEndChimePlayed: true }).catch(() => {});
          }
          if (breakSeconds <= 0) {
            this.finishBreak();
            return;
          }
        }

        // Sync focus stats every 4 seconds (8 intervals of 500ms)
        if (tickCount % 8 === 0 && state.isRunning) {
          const totalSecs = Math.max(0, targetTotalSecs - focusSeconds);
          storageService.syncTodayFocusSeconds(totalSecs, state.currentTask);
        }

        const displaySecs = (state.currentTab === "break") ? breakSeconds : focusSeconds;
        this.updateDisplay(displaySecs, state, settings);
      }, 500);
    }

    const currentDisplaySecs = (state.currentTab === "break") ? breakSeconds : focusSeconds;
    this.updateDisplay(currentDisplaySecs, state, settings);
    this.updateButtons(state);
    this.updateTopButtonState(state, focusSeconds);
  }

  formatFsTime(totalSeconds) {
    if (totalSeconds >= 3600) {
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  updateDisplay(totalSeconds, state, settings = null) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    const isBreakTab = (state.currentTab === "break");

    // 1. Mini countdown display
    if (this.timerDisplayEl) {
      this.timerDisplayEl.textContent = timeStr;
    }

    // 2. Fullscreen Big Time display (e.g. 10:00:00, 9:55:20 or 08:00)
    if (this.fsTimeEl) {
      this.fsTimeEl.textContent = this.formatFsTime(totalSeconds);
      this.fsTimeEl.style.cursor = isBreakTab ? "default" : "pointer";
    }

    // 3. SVG Arc fill progress
    if (this.fsArcFill) {
      const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
      const defaultDuration = (settings && settings.focusDuration ? settings.focusDuration : 120);
      const maxSecs = isBreakTab ? breakSecs : Math.max(1, (state.durationMinutes || defaultDuration) * 60);
      const elapsed = Math.max(0, maxSecs - totalSeconds);
      const progress = Math.max(0, Math.min(1, elapsed / maxSecs));
      let C = 1484;
      try {
        if (typeof this.fsArcFill.getTotalLength === "function") {
          const l = this.fsArcFill.getTotalLength();
          if (l > 0) C = l;
        }
      } catch (e) {}

      if (progress <= 0.0005) {
        this.fsArcFill.style.opacity = "0";
        this.fsArcFill.style.strokeDashoffset = C;
      } else {
        this.fsArcFill.style.opacity = "1";
        const offset = (C * (1 - progress)).toFixed(1);
        this.fsArcFill.style.strokeDashoffset = offset;
      }
    }

    // 4. Center Play/Pause button icons
    if (this.fsIconPause && this.fsIconPlay) {
      this.fsIconPause.classList.toggle("hidden", !state.isRunning);
      this.fsIconPlay.classList.toggle("hidden", state.isRunning);
    }

    // 5. Top-Center Status Pill Label
    if (this.topStatusLabel) {
      if (isBreakTab || state.breakIsRunning) {
        this.topStatusLabel.textContent = "On Break";
      } else {
        this.topStatusLabel.textContent = "Focusing";
      }
    }

    // 6. Tabs active & locked state
    if (this.fsTabFocus && this.fsTabBreak) {
      this.fsTabBreak.classList.toggle("active", isBreakTab);
      this.fsTabFocus.classList.toggle("active", !isBreakTab);

      const breakMins = settings && settings.breakDuration ? settings.breakDuration : 5;
      const intervalMins = settings && settings.focusInterval ? settings.focusInterval : 60;
      const canBreak = Boolean(state.breakUnlocked || state.breakIsRunning);
      this.fsTabBreak.classList.toggle("disabled", !canBreak);
      this.fsTabBreak.classList.toggle("unlocked", canBreak);

      if (canBreak) {
        this.fsTabBreak.removeAttribute("disabled");
        this.fsTabBreak.setAttribute("title", `Rest for ${breakMins}m (Unlocked after ${this.formatIntervalDuration(intervalMins)} focus)`);
      } else {
        this.fsTabBreak.setAttribute("disabled", "true");
        const currentContinuous = state.continuousFocusSeconds || 0;
        const minsRun = Math.floor(currentContinuous / 60);
        this.fsTabBreak.setAttribute("title", `Focus continuously for ${this.formatIntervalDuration(intervalMins)} to unlock Break (${minsRun}/${intervalMins}m)`);
      }
    }

    // 7. Task input text
    if (this.fsTaskInput && document.activeElement !== this.fsTaskInput) {
      if (isBreakTab) {
        const breakMins = settings && settings.breakDuration ? settings.breakDuration : 5;
        this.fsTaskInput.value = `☕ Rest for ${breakMins}m - Recharge your energy`;
      } else {
        this.fsTaskInput.value = state.currentTask || "";
      }
    }

    // 8. Mini Popover mode badge
    if (this.modeBadgeEl) {
      this.modeBadgeEl.className = "mode-badge";
      if (isBreakTab || state.breakIsRunning) {
        this.modeBadgeEl.textContent = "☕ Break";
        this.modeBadgeEl.classList.add("mode-break");
      } else if (state.isRunning) {
        this.modeBadgeEl.textContent = "🎯 Focus";
        this.modeBadgeEl.classList.add("mode-focus");
      } else {
        this.modeBadgeEl.textContent = "Ready";
        this.modeBadgeEl.classList.add("mode-idle");
      }
    }

  }

  formatIntervalDuration(totalMins) {
    if (totalMins < 60) {
      return `${totalMins}m`;
    }
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (mins === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }

  updateTopButtonState(state, totalSeconds) {
    if (!this.topFocusBtn) return;
    const labelEl = this.topFocusBtn.querySelector(".top-focus-label");
    if (labelEl) {
      labelEl.textContent = "Focus";
    }
  }

  updateButtons(state) {
    const isRunning = state.isRunning;
    const totalAllowedSecs = (state.durationMinutes || 120) * 60;
    const isIdle = (state.remainingSeconds >= totalAllowedSecs && !isRunning);

    if (this.startBtn) this.startBtn.classList.toggle("hidden", !isIdle);
    if (this.pauseBtn) this.pauseBtn.classList.toggle("hidden", !isRunning);
    if (this.resumeBtn) this.resumeBtn.classList.toggle("hidden", isRunning || isIdle);
    if (this.resetBtn) this.resetBtn.classList.toggle("hidden", isIdle);
    if (this.skipBtn) this.skipBtn.classList.toggle("hidden", isIdle);
  }
}

const focusManager = new FocusManager();
window.focusManager = focusManager;
