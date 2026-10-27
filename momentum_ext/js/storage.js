/**
 * Storage Service for Momentum Firefox Extension
 * Handles local settings, Pomodoro state, and Daily/Monthly Focus Stats
 */

const DEFAULT_WALLPAPERS = [
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2560&q=85", // Yosemite Valley
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=2560&q=85", // Foggy mountain sunrise
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=2560&q=85", // Forest sunlight
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2560&q=85", // Mountain landscape
  "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=2560&q=85", // Sunlight through trees
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2560&q=85", // Tropical sunset beach
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=2560&q=85"  // Peaceful valley
];

const DEFAULT_SETTINGS = {
  userName: "",
  focusDuration: 120,   // 2 hours default
  breakDuration: 5,     // 5 minutes
  is24h: true,
  wallpapers: DEFAULT_WALLPAPERS,
  todayFocus: { text: "", completed: false, date: "" }
};

const DEFAULT_FOCUS_STATE = {
  date: "",                     // "YYYY-MM-DD" of the active day
  mode: "focus",                // "focus" | "break" | "idle"
  isRunning: false,
  targetTimestamp: null,        // ms timestamp when timer finishes
  durationMinutes: 120,         // 2 hours default allowance
  remainingSeconds: 120 * 60,   // 7,200s default
  sessionStartTime: null,
  currentTask: "",

  // Continuous focus & Break tab
  continuousFocusSeconds: 0,    // seconds of continuous running focus
  lastContinuousBase: 0,
  breakUnlocked: false,         // true after continuous focus reaches focusInterval
  breakRemainingSeconds: 5 * 60,// 5 minutes = 300 seconds
  breakIsRunning: false,
  breakTargetTimestamp: null,
  currentTab: "focus"           // "focus" | "break"
};

class StorageService {
  constructor() {
    this.api = (typeof browser !== "undefined" && browser.storage) 
      ? browser.storage.local 
      : (typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null);
  }

  async get(keys) {
    if (!this.api) {
      // Fallback to localStorage if running outside extension context
      if (typeof localStorage !== "undefined") {
        if (typeof keys === "string") {
          const val = localStorage.getItem(keys);
          return { [keys]: val ? JSON.parse(val) : undefined };
        }
        const res = {};
        for (const k of keys) {
          const val = localStorage.getItem(k);
          if (val) res[k] = JSON.parse(val);
        }
        return res;
      }
      return {};
    }
    return new Promise((resolve) => {
      this.api.get(keys, (result) => resolve(result || {}));
    });
  }

  async set(items) {
    // 1. Fast-Path: Write to synchronous localStorage cache immediately (0ms access)
    try {
      if (typeof localStorage !== "undefined") {
        for (const [k, v] of Object.entries(items)) {
          localStorage.setItem(`momentum_cache_${k}`, JSON.stringify(v));
          localStorage.setItem(k, JSON.stringify(v));
        }
      }
    } catch (e) {}

    if (!this.api) {
      return;
    }
    return new Promise((resolve) => {
      this.api.set(items, () => resolve());
    });
  }

  // --- Synchronous Fast-Path Readers (Instant 0ms retrieval) ---
  getSettingsSync() {
    try {
      if (typeof localStorage !== "undefined") {
        const val = localStorage.getItem("momentum_cache_settings");
        if (val) {
          const parsed = JSON.parse(val);
          const settings = { ...DEFAULT_SETTINGS, ...parsed };
          return settings;
        }
      }
    } catch (e) {}
    return { ...DEFAULT_SETTINGS };
  }

  getFocusStateSync() {
    const todayStr = this.getTodayDateString();
    try {
      if (typeof localStorage !== "undefined") {
        const val = localStorage.getItem("momentum_cache_focus_state");
        if (val) {
          const parsed = JSON.parse(val);
          const state = { ...DEFAULT_FOCUS_STATE, ...parsed };
          if (state.date && state.date !== todayStr) {
            // New day rollover
            return {
              ...DEFAULT_FOCUS_STATE,
              date: todayStr
            };
          }
          return state;
        }
      }
    } catch (e) {}
    return { ...DEFAULT_FOCUS_STATE, date: todayStr };
  }

  // --- Settings & Profile ---
  async getSettings() {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        const dbSettings = await window.momentumDB.getSettings();
        if (dbSettings) return dbSettings;
      } catch (e) {}
    }
    const data = await this.get(["settings"]);
    const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    // Keep synchronous cache updated
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_settings", JSON.stringify(settings));
      }
    } catch (e) {}
    return settings;
  }

  async saveSettings(settings) {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.updateSettings(settings);
      } catch (e) {}
    }
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await this.set({ settings: updated });
    return updated;
  }

  async setSetting(key, val) {
    return this.saveSettings({ [key]: val });
  }

  async getUserName() {
    const settings = await this.getSettings();
    return settings.userName || "";
  }

  async setUserName(name) {
    return this.saveSettings({ userName: name.trim() });
  }

  async getTodayFocus() {
    const settings = await this.getSettings();
    const todayStr = this.getTodayDateString();
    if (settings.todayFocus && settings.todayFocus.date === todayStr) {
      return settings.todayFocus;
    }
    return { text: "", completed: false, date: todayStr };
  }

  async setTodayFocus(text, completed = false) {
    const todayStr = this.getTodayDateString();
    const todayFocus = { text: text.trim(), completed, date: todayStr };
    await this.saveSettings({ todayFocus });
    return todayFocus;
  }

  // --- Focus Timer State ---
  async getFocusState() {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        const dbState = await window.momentumDB.getFocusState();
        if (dbState) {
          // Keep synchronous cache updated
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("momentum_cache_focus_state", JSON.stringify(dbState));
            }
          } catch (e) {}
          return dbState;
        }
      } catch (e) {}
    }

    const data = await this.get(["focus_state"]);
    let state = { ...DEFAULT_FOCUS_STATE, ...(data.focus_state || {}) };
    const todayStr = this.getTodayDateString();

    // Daily Rollover Check: Reset daily focus hours for new days!
    const settings = await this.getSettings();
    const defaultFocusMins = settings && settings.focusDuration ? settings.focusDuration : 120;
    const defaultBreakMins = settings && settings.breakDuration ? settings.breakDuration : 5;

    if (!state.date || state.date !== todayStr) {
      state.date = todayStr;
      state.durationMinutes = defaultFocusMins;
      state.remainingSeconds = defaultFocusMins * 60;
      state.isRunning = false;
      state.targetTimestamp = null;
      state.sessionStartTime = null;
      state.continuousFocusSeconds = 0;
      state.lastContinuousBase = 0;
      state.breakUnlocked = false;
      state.breakRemainingSeconds = defaultBreakMins * 60;
      state.breakIsRunning = false;
      state.breakTargetTimestamp = null;
      state.currentTab = "focus";
      await this.set({ focus_state: state });
    }

    // Keep synchronous cache updated
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_focus_state", JSON.stringify(state));
      }
    } catch (e) {}
    return state;
  }

  async saveFocusState(state) {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.saveFocusState(state);
      } catch (e) {}
    }
    const current = await this.getFocusState();
    const updated = { ...current, ...state };
    await this.set({ focus_state: updated });
    return updated;
  }

  // --- Focus Stats by Day & Month ---
  getTodayDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async getAllStats() {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        const statsList = await window.momentumDB.getAllStoreItems("focus_stats");
        if (Array.isArray(statsList) && statsList.length > 0) {
          const statsMap = {};
          statsList.forEach((s) => {
            if (s && s.date) statsMap[s.date] = s;
          });
          return statsMap;
        }
      } catch (e) {}
    }
    const data = await this.get(["focus_stats"]);
    return data.focus_stats || {};
  }

  async syncTodayFocusSeconds(totalSecondsFocusedToday, activeTask = "") {
    const todayStr = this.getTodayDateString();
    const allStats = await this.getAllStats();
    
    if (!allStats[todayStr]) {
      allStats[todayStr] = {
        date: todayStr,
        totalMinutes: 0,
        totalSeconds: 0,
        completedSessions: 0,
        sessions: []
      };
    }

    const currentTotalSecs = Number(totalSecondsFocusedToday || 0);
    allStats[todayStr].totalSeconds = currentTotalSecs;
    allStats[todayStr].totalMinutes = Math.floor(currentTotalSecs / 60);

    // Save into MomentumDB store focus_stats
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.putStoreItem("focus_stats", allStats[todayStr]);
      } catch (e) {}
    }

    // Save write-through cache immediately
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_focus_stats", JSON.stringify(allStats));
      }
    } catch (e) {}

    await this.set({ focus_stats: allStats });
    return allStats[todayStr];
  }

  async recordCompletedSession(session) {
    // session: { start, end, duration, task }
    const dateStr = this.getTodayDateString(new Date(session.end || Date.now()));
    const allStats = await this.getAllStats();
    
    if (!allStats[dateStr]) {
      allStats[dateStr] = {
        date: dateStr,
        totalMinutes: 0,
        totalSeconds: 0,
        completedSessions: 0,
        sessions: []
      };
    }

    const durationMins = Math.max(1, Math.round(Number(session.duration || 0)));
    allStats[dateStr].completedSessions = (allStats[dateStr].completedSessions || 0) + 1;
    if (!allStats[dateStr].sessions) allStats[dateStr].sessions = [];
    allStats[dateStr].sessions.push({
      id: Date.now().toString(),
      start: session.start || new Date().toISOString(),
      end: session.end || new Date().toISOString(),
      duration: durationMins,
      task: session.task || ""
    });

    // Save into MomentumDB store focus_stats
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.putStoreItem("focus_stats", allStats[dateStr]);
      } catch (e) {}
    }

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_focus_stats", JSON.stringify(allStats));
      }
    } catch (e) {}

    await this.set({ focus_stats: allStats });
    return allStats[dateStr];
  }

  async getStatsByDate(dateStr) {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        const item = await window.momentumDB.getStoreItem("focus_stats", dateStr);
        if (item) return item;
      } catch (e) {}
    }
    const allStats = await this.getAllStats();
    return allStats[dateStr] || {
      date: dateStr,
      totalMinutes: 0,
      totalSeconds: 0,
      completedSessions: 0,
      sessions: []
    };
  }

  async getStatsByMonth(year, month) {
    // year: number (e.g. 2026), month: number (1-12)
    const allStats = await this.getAllStats();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const result = {
      year,
      month,
      totalMinutes: 0,
      totalSessions: 0,
      activeDaysCount: 0,
      days: {}
    };

    // Populate all days in this month
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${prefix}-${String(d).padStart(2, "0")}`;
      const dayData = allStats[dayKey] || {
        date: dayKey,
        totalMinutes: 0,
        totalSeconds: 0,
        completedSessions: 0,
        sessions: []
      };
      result.days[dayKey] = dayData;
      result.totalMinutes += (dayData.totalMinutes || 0);
      result.totalSessions += (dayData.completedSessions || 0);
      if (dayData.totalMinutes > 0 || (dayData.completedSessions && dayData.completedSessions > 0)) {
        result.activeDaysCount += 1;
      }
    }

    return result;
  }

  // --- Clean Demo Stats and restore real data only ---
  async cleanDemoStats() {
    const allStats = await this.getAllStats();
    let changed = false;
    const todayStr = this.getTodayDateString();

    for (const dateKey of Object.keys(allStats)) {
      const dayData = allStats[dateKey];
      if (!dayData) continue;
      const isDemo = dayData.sessions && dayData.sessions.some(s => (s.id && String(s.id).startsWith("demo-")) || s.task === "Deep Focus Session");
      if (isDemo) {
        if (dateKey === todayStr) {
          const realSessions = (dayData.sessions || []).filter(s => (!s.id || !String(s.id).startsWith("demo-")) && s.task !== "Deep Focus Session");
          dayData.sessions = realSessions;
          dayData.totalMinutes = realSessions.reduce((acc, s) => acc + (s.duration || 0), 0);
          dayData.totalSeconds = dayData.totalMinutes * 60;
          dayData.completedSessions = realSessions.length;
          changed = true;
        } else {
          delete allStats[dateKey];
          changed = true;
        }
      }
    }

    if (changed) {
      await this.set({ focus_stats: allStats });
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("momentum_cache_focus_stats", JSON.stringify(allStats));
        }
      } catch (e) {}
    }
    return allStats;
  }

  // --- Sounds & Music Library Management ---
  async getCustomSounds() {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        return await window.momentumDB.getCustomSounds();
      } catch (e) {}
    }
    const res = await this.get("custom_sounds");
    return Array.isArray(res.custom_sounds) ? res.custom_sounds : [];
  }

  async saveCustomSound(soundItem) {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.putStoreItem("custom_sounds", soundItem);
        return await window.momentumDB.getCustomSounds();
      } catch (e) {}
    }
    const sounds = await this.getCustomSounds();
    const updated = [soundItem, ...sounds.filter(s => s.id !== soundItem.id)];
    await this.set({ custom_sounds: updated });
    return updated;
  }

  async deleteCustomSound(id) {
    if (typeof window !== "undefined" && window.momentumDB) {
      try {
        await window.momentumDB.deleteCustomSound(id);
        return await window.momentumDB.getCustomSounds();
      } catch (e) {}
    }
    const sounds = await this.getCustomSounds();
    const updated = sounds.filter(s => s.id !== id);
    await this.set({ custom_sounds: updated });
    return updated;
  }

  async getActiveSound() {
    const res = await this.get("active_sound");
    return res.active_sound || null;
  }

  async saveActiveSound(soundItem) {
    await this.set({ active_sound: soundItem });
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_active_sound", JSON.stringify(soundItem));
      }
    } catch (e) {}
    return soundItem;
  }
}

// Global instance
const storageService = new StorageService();
if (typeof window !== "undefined") {
  window.storageService = storageService;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { StorageService, storageService, DEFAULT_SETTINGS, DEFAULT_WALLPAPERS };
}
