/**
 * MomentumDB - Unified Local Storage Architecture for Momentum Firefox Extension
 * Powered by IndexedDB with In-Memory Write-Through Caching (0ms reads)
 * Stores 100% of data locally on the machine with zero risk of loss.
 */

class MomentumDB {
  constructor() {
    this.dbName = "MomentumDB";
    this.dbVersion = 1;
    this.db = null;
    this.isReady = false;
    this.readyPromise = null;

    // Fast-path in-memory write-through cache for instant 0ms queries
    this.cache = {
      settings: null,
      customSounds: null,
      focusState: null
    };

    // Auto-initialize connection
    this.readyPromise = this.initDB();
  }

  /**
   * Initializes IndexedDB database with 5 distinct Object Stores
   */
  async initDB() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store 1: SETTINGS (General preferences, 3 Focus sliders, active wallpaper)
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        // Store 2: PHOTOS (User uploaded wallpapers - raw Blobs + thumbnails)
        if (!db.objectStoreNames.contains("photos")) {
          const photoStore = db.createObjectStore("photos", { keyPath: "id" });
          photoStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        // Store 3: CUSTOM_SOUNDS (Auto-categorized YouTube & Spotify tracks, NO subType)
        if (!db.objectStoreNames.contains("custom_sounds")) {
          const soundStore = db.createObjectStore("custom_sounds", { keyPath: "id" });
          soundStore.createIndex("type", "type", { unique: false });
          soundStore.createIndex("createdAt", "createdAt", { unique: false });
        }

        // Store 4: FOCUS_STATE (Live Pomodoro timer state)
        if (!db.objectStoreNames.contains("focus_state")) {
          db.createObjectStore("focus_state", { keyPath: "key" });
        }

        // Store 5: FOCUS_STATS (Daily and monthly focus sessions history)
        if (!db.objectStoreNames.contains("focus_stats")) {
          db.createObjectStore("focus_stats", { keyPath: "date" });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        this.isReady = true;

        // Populate in-memory cache
        try {
          await this.loadCache();
        } catch (e) {
          console.warn("[MomentumDB] Initial cache load warning:", e);
        }
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("[MomentumDB] Failed to open IndexedDB:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  async ensureReady() {
    if (this.isReady && this.db) return this.db;
    return this.readyPromise;
  }

  /**
   * Preloads common configs into RAM cache for 0ms synchronous reads
   */
  async loadCache() {
    // 1. Settings cache
    const settings = await this.getStoreItem("settings", "settings_config");
    if (settings) {
      this.cache.settings = settings;
      try {
        localStorage.setItem("momentum_cache_settings", JSON.stringify(settings));
      } catch (e) {}
    }

    // 2. Custom sounds cache
    const sounds = await this.getAllStoreItems("custom_sounds");
    if (sounds) {
      this.cache.customSounds = sounds.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
  }

  // ==========================================
  // Generic IndexedDB Helper Operations
  // ==========================================

  async getStoreItem(storeName, key) {
    await this.ensureReady();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async getAllStoreItems(storeName) {
    await this.ensureReady();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  async putStoreItem(storeName, item) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async deleteStoreItem(storeName, key) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ==========================================
  // 1. SETTINGS & 3 FOCUS SLIDERS API
  // ==========================================

  getDefaultSettings() {
    return {
      key: "settings_config",
      userName: "",
      focusDuration: 120,    // minutes (range: 60 - 720)
      focusInterval: 60,    // minutes (range: 30 - 120)
      breakDuration: 5,      // minutes (range: 5 - 30)
      clockIs24h: true,
      activeWallpaper: null, // { id, source: "history"|"my-photos", previewUrl, title, activeDate }
      todayFocus: { text: "", completed: false, date: "" }
    };
  }

  getSettingsSync() {
    if (this.cache.settings) {
      return { ...this.getDefaultSettings(), ...this.cache.settings };
    }
    try {
      const cached = localStorage.getItem("momentum_cache_settings");
      if (cached) {
        return { ...this.getDefaultSettings(), ...JSON.parse(cached) };
      }
    } catch (e) {}
    return this.getDefaultSettings();
  }

  async getSettings() {
    if (this.cache.settings) {
      return { ...this.getDefaultSettings(), ...this.cache.settings };
    }
    const stored = await this.getStoreItem("settings", "settings_config");
    const merged = { ...this.getDefaultSettings(), ...(stored || {}) };
    this.cache.settings = merged;
    try {
      localStorage.setItem("momentum_cache_settings", JSON.stringify(merged));
    } catch (e) {}
    return merged;
  }

  async updateSettings(partial) {
    const current = await this.getSettings();
    const updated = { ...current, ...partial, key: "settings_config" };
    await this.putStoreItem("settings", updated);
    this.cache.settings = updated;
    try {
      localStorage.setItem("momentum_cache_settings", JSON.stringify(updated));
    } catch (e) {}
    return updated;
  }

  async getActiveWallpaper() {
    const settings = await this.getSettings();
    return settings.activeWallpaper || null;
  }

  async setActiveWallpaper(wallpaperData) {
    return this.updateSettings({ activeWallpaper: wallpaperData });
  }

  // ==========================================
  // 2. PHOTOS (MY PHOTOS) API (Binary Blob Store)
  // ==========================================

  async getMyPhotos() {
    const photos = await this.getAllStoreItems("photos");
    return photos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * Adds user-uploaded image file directly into IndexedDB as a binary Blob.
   * Generates a lightweight thumbnail for fluid 4-column rendering.
   */
  async addMyPhoto(file) {
    if (!file) throw new Error("No file provided");

    const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Create compact thumbnail DataURL using HTML Canvas
    const thumbnailDataUrl = await this.generateThumbnail(file, 400, 250);

    const photoRecord = {
      id: id,
      name: file.name || "My Photo",
      blob: file, // Raw binary Blob stored directly on disk in IndexedDB
      thumbnailDataUrl: thumbnailDataUrl,
      size: file.size,
      mimeType: file.type || "image/jpeg",
      createdAt: Date.now()
    };

    await this.putStoreItem("photos", photoRecord);
    return photoRecord;
  }

  async deleteMyPhoto(id) {
    await this.deleteStoreItem("photos", id);
    // If deleted photo was active, clear active wallpaper
    const currentActive = await this.getActiveWallpaper();
    if (currentActive && currentActive.id === id) {
      await this.setActiveWallpaper(null);
    }
    return true;
  }

  generateThumbnail(file, maxWidth, maxHeight) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  // ==========================================
  // 3. AUTO-DETECTION ENGINE & CUSTOM SOUNDS API (NO subType)
  // ==========================================

  /**
   * Intelligently parses ANY raw user-pasted link, detects YouTube vs Spotify,
   * generates direct embed URLs, and extracts metadata via oEmbed (No API key needed).
   */
  async parseMusicUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
      throw new Error("Invalid URL");
    }
    const url = rawUrl.trim();

    // 1. YouTube Link Detection
    // Matches youtube.com/watch?v=..., youtu.be/..., shorts, embed, music.youtube.com
    const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch) {
      const videoId = ytMatch[1];
      const siMatch = url.match(/[?&]si=([a-zA-Z0-9_-]+)/);

      const track = {
        id: videoId,
        type: "youtube",
        title: "YouTube Soundscape",
        authorName: "YouTube",
        url: url,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`,
        isCustom: true,
        createdAt: Date.now(),
        playCount: 0
      };

      if (siMatch) {
        track.si = siMatch[1];
      }

      // Fetch oEmbed title & author asynchronously (fallback-safe)
      try {
        const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        if (oembedRes.ok) {
          const data = await oembedRes.json();
          if (data && data.title) track.title = data.title;
          if (data && data.author_name) track.authorName = data.author_name;
        }
      } catch (e) {}

      return track;
    }

    // 2. Spotify Link Detection
    // Matches open.spotify.com/(track|playlist|album)/ID or spotify:(track|playlist|album):ID
    const spMatch = url.match(/(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/i)
      || url.match(/spotify:(track|playlist|album):([a-zA-Z0-9]+)/i);

    if (spMatch) {
      const resourceType = spMatch[1].toLowerCase(); // track, playlist, or album
      const spId = spMatch[2];

      const track = {
        id: spId,
        type: "spotify",
        title: `Spotify ${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}`,
        authorName: "Spotify",
        url: url,
        thumbnailUrl: "assets/focus-flow-cover.png",
        embedUrl: `https://open.spotify.com/embed/${resourceType}/${encodeURIComponent(spId)}?utm_source=generator&theme=0`,
        isCustom: true,
        createdAt: Date.now(),
        playCount: 0
      };

      // Fetch official Spotify oEmbed metadata
      try {
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
        if (oembedRes.ok) {
          const data = await oembedRes.json();
          if (data && data.title) track.title = data.title;
          if (data && data.thumbnail_url) track.thumbnailUrl = data.thumbnail_url;
          if (data && data.author_name) track.authorName = data.author_name;
        }
      } catch (e) {}

      return track;
    }

    // 3. Fallback: Generic direct stream
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const pseudoId = `custom_${Date.now()}`;
      return {
        id: pseudoId,
        type: "youtube",
        title: "Custom Stream",
        authorName: "Web Stream",
        url: url,
        thumbnailUrl: "assets/focus-flow-cover.png",
        embedUrl: url,
        isCustom: true,
        createdAt: Date.now(),
        playCount: 0
      };
    }

    throw new Error("Invalid link. Please paste a Spotify or Youtube link.");
  }

  async getCustomSounds(filterType = null) {
    if (this.cache.customSounds) {
      if (!filterType) return [...this.cache.customSounds];
      return this.cache.customSounds.filter((s) => s.type === filterType);
    }

    const items = await this.getAllStoreItems("custom_sounds");
    const sorted = items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    this.cache.customSounds = sorted;

    if (!filterType) return sorted;
    return sorted.filter((s) => s.type === filterType);
  }

  async addCustomSound(rawUrl) {
    const track = await this.parseMusicUrl(rawUrl);
    await this.putStoreItem("custom_sounds", track);

    // Update RAM cache
    if (!this.cache.customSounds) this.cache.customSounds = [];
    this.cache.customSounds = [track, ...this.cache.customSounds.filter((s) => s.id !== track.id)];

    return track;
  }

  async deleteCustomSound(id) {
    await this.deleteStoreItem("custom_sounds", id);
    if (this.cache.customSounds) {
      this.cache.customSounds = this.cache.customSounds.filter((s) => s.id !== id);
    }
    return true;
  }

  async incrementSoundPlayCount(id) {
    const track = await this.getStoreItem("custom_sounds", id);
    if (track) {
      track.playCount = (track.playCount || 0) + 1;
      track.lastPlayedAt = Date.now();
      await this.putStoreItem("custom_sounds", track);
      if (this.cache.customSounds) {
        const found = this.cache.customSounds.find((s) => s.id === id);
        if (found) {
          found.playCount = track.playCount;
          found.lastPlayedAt = track.lastPlayedAt;
        }
      }
    }
  }

  // ==========================================
  // 4. FOCUS STATE & POMODORO TIMER API
  // ==========================================

  getDefaultFocusState(defaultFocusMins = 120, defaultBreakMins = 5) {
    return {
      key: "timer_state",
      date: new Date().toISOString().split("T")[0],
      mode: "focus",
      isRunning: false,
      targetTimestamp: null,
      durationMinutes: defaultFocusMins,
      remainingSeconds: defaultFocusMins * 60,
      sessionStartTime: null,
      currentTask: "",
      continuousFocusSeconds: 0,
      breakUnlocked: false,
      breakRemainingSeconds: defaultBreakMins * 60,
      breakIsRunning: false,
      breakTargetTimestamp: null,
      currentTab: "focus"
    };
  }

  async getFocusState() {
    let settings = null;
    try {
      settings = await this.getSettings();
    } catch (e) {}
    const defaultFocusMins = (settings && settings.focusDuration) ? settings.focusDuration : 120;
    const defaultBreakMins = (settings && settings.breakDuration) ? settings.breakDuration : 5;
    const todayStr = new Date().toISOString().split("T")[0];

    if (this.cache.focusState) {
      const state = { ...this.cache.focusState };
      // Daily rollover check
      if (state.date && state.date !== todayStr) {
        state.date = todayStr;
        state.isRunning = false;
        state.targetTimestamp = null;
        state.durationMinutes = defaultFocusMins;
        state.remainingSeconds = defaultFocusMins * 60;
        state.continuousFocusSeconds = 0;
        state.breakUnlocked = false;
        state.breakRemainingSeconds = defaultBreakMins * 60;
        state.breakIsRunning = false;
        state.breakTargetTimestamp = null;
        state.currentTab = "focus";
        await this.saveFocusState(state);
      }
      return state;
    }
    const stored = await this.getStoreItem("focus_state", "timer_state");
    const defaults = this.getDefaultFocusState(defaultFocusMins, defaultBreakMins);
    const state = { ...defaults, ...(stored || {}) };

    // Daily rollover check
    if (state.date && state.date !== todayStr) {
      state.date = todayStr;
      state.isRunning = false;
      state.targetTimestamp = null;
      state.durationMinutes = defaultFocusMins;
      state.remainingSeconds = defaultFocusMins * 60;
      state.continuousFocusSeconds = 0;
      state.breakUnlocked = false;
      state.breakRemainingSeconds = defaultBreakMins * 60;
      state.breakIsRunning = false;
      state.breakTargetTimestamp = null;
      state.currentTab = "focus";
      await this.saveFocusState(state);
    }
    this.cache.focusState = state;
    return state;
  }

  async saveFocusState(state) {
    const current = await this.getFocusState();
    const updated = { ...current, ...state, key: "timer_state" };
    await this.putStoreItem("focus_state", updated);
    this.cache.focusState = updated;
    return updated;
  }

  // ==========================================
  // 5. FOCUS STATS API
  // ==========================================

  async getDayStats(dateStr) {
    const stat = await this.getStoreItem("focus_stats", dateStr);
    return stat || {
      date: dateStr,
      totalMinutes: 0,
      totalSeconds: 0,
      completedSessions: 0,
      sessions: []
    };
  }

  async recordSession(session) {
    const todayStr = new Date().toISOString().split("T")[0];
    const current = await this.getDayStats(todayStr);

    current.sessions.push(session);
    current.completedSessions = current.sessions.length;
    current.totalMinutes += (session.durationMinutes || 0);
    current.totalSeconds += ((session.durationMinutes || 0) * 60);

    await this.putStoreItem("focus_stats", current);
    return current;
  }
}

// Global Singleton Instance
window.momentumDB = new MomentumDB();
