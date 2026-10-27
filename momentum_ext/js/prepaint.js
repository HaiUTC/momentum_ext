/**
 * Synchronous Pre-paint Bootstrap (0ms flash of default content)
 * Separated from HTML to comply strictly with Manifest V3 CSP (no inline scripts).
 */

// 1. Critical pre-paint synchronous HTML class (runs immediately in <head>)
(function prePaintHtml() {
  try {
    const cachedSettings = localStorage.getItem("momentum_cache_settings");
    const settings = cachedSettings ? JSON.parse(cachedSettings) : null;
    if (settings && settings.focusModeActive) {
      document.documentElement.classList.add("focus-mode-active");
    }
  } catch (e) {}
})();

// 2. Synchronous pre-paint of background, clock, greeting, and focus state
function prePaintDom() {
  try {
    // A. Wallpaper
    const cachedWp = localStorage.getItem("momentum_cache_wallpaper");
    if (cachedWp) {
      const bg = document.getElementById("background-layer");
      if (bg) {
        bg.style.backgroundImage = 'url("' + cachedWp + '")';
        bg.classList.add("loaded");
      }
    }

    // B. Clock & Greeting
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");

    let is24h = true;
    let userName = "";
    const cachedSettings = localStorage.getItem("momentum_cache_settings");
    if (cachedSettings) {
      const s = JSON.parse(cachedSettings);
      if (s.is24h === false) is24h = false;
      if (s.userName) userName = s.userName;
    }

    let formattedTime = "";
    if (is24h) {
      formattedTime = String(hours).padStart(2, "0") + ":" + minutes;
    } else {
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      formattedTime = hours + ":" + minutes + " " + ampm;
    }

    let greeting = "Good day";
    const h = now.getHours();
    if (h >= 4 && h < 12) greeting = "Good morning";
    else if (h >= 12 && h < 18) greeting = "Good afternoon";
    else greeting = "Good evening";

    const timeEl = document.getElementById("clock-time");
    const greetTextEl = document.getElementById("greeting-text");
    const greetNameEl = document.getElementById("greeting-name");
    if (timeEl) timeEl.textContent = formattedTime;
    if (greetTextEl) greetTextEl.textContent = greeting + ", ";
    if (greetNameEl) greetNameEl.textContent = userName ? (userName + ".") : "friend.";

    // C. Focus Mode State
    const cachedFocus = localStorage.getItem("momentum_cache_focus_state");
    if (cachedFocus) {
      let defaultFocusMins = 120;
      let defaultBreakMins = 5;
      if (cachedSettings) {
        try {
          const s = JSON.parse(cachedSettings);
          if (s.focusDuration) defaultFocusMins = s.focusDuration;
          if (s.breakDuration) defaultBreakMins = s.breakDuration;
        } catch (e) {}
      }

      const state = JSON.parse(cachedFocus);
      const isBreakTab = (state.currentTab === "break");

      let secs = (!state.isRunning && defaultFocusMins) ? (defaultFocusMins * 60) : (state.remainingSeconds || ((state.durationMinutes || defaultFocusMins) * 60));
      if (state.isRunning && state.targetTimestamp) {
        secs = Math.max(0, Math.round((state.targetTimestamp - Date.now()) / 1000));
      }

      if (isBreakTab) {
        let breakSecs = (!state.breakIsRunning && defaultBreakMins) ? (defaultBreakMins * 60) : (state.breakRemainingSeconds || (defaultBreakMins * 60));
        if (state.breakIsRunning && state.breakTargetTimestamp) {
          breakSecs = Math.max(0, Math.round((state.breakTargetTimestamp - Date.now()) / 1000));
        }
        secs = breakSecs;
      }

      let timeStr = "";
      if (secs >= 3600) {
        const hh = Math.floor(secs / 3600);
        const mm = Math.floor((secs % 3600) / 60);
        const ss = secs % 60;
        timeStr = hh + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      } else {
        const mm = Math.floor(secs / 60);
        const ss = secs % 60;
        timeStr = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      }
      const fsTimeEl = document.getElementById("focus-fs-time");
      if (fsTimeEl) fsTimeEl.textContent = timeStr;

      const tabFocus = document.getElementById("focus-tab-focus");
      const tabBreak = document.getElementById("focus-tab-break");
      if (tabFocus && tabBreak) {
        tabFocus.classList.toggle("active", !isBreakTab);
        tabBreak.classList.toggle("active", isBreakTab);
        const canBreak = Boolean(state.breakUnlocked || state.breakIsRunning);
        tabBreak.classList.toggle("disabled", !canBreak);
        tabBreak.classList.toggle("unlocked", canBreak);
      }

      if (state.currentTask) {
        const taskInput = document.getElementById("focus-fs-task-input");
        if (taskInput) taskInput.value = state.currentTask;
      }

      const iconPause = document.getElementById("focus-icon-pause");
      const iconPlay = document.getElementById("focus-icon-play");
      if (iconPause && iconPlay) {
        iconPause.classList.toggle("hidden", !state.isRunning);
        iconPlay.classList.toggle("hidden", state.isRunning);
      }

      const arcFill = document.getElementById("focus-fs-arc-fill");
      if (arcFill) {
        const totalSecs = isBreakTab ? (defaultBreakMins * 60) : Math.max(1, (state.durationMinutes || defaultFocusMins) * 60);
        const elapsed = Math.max(0, totalSecs - secs);
        const progress = Math.max(0, Math.min(1, elapsed / totalSecs));
        const C = 1484;
        if (progress <= 0.0005) {
          arcFill.style.opacity = "0";
          arcFill.style.strokeDashoffset = C;
        } else {
          arcFill.style.opacity = "1";
          arcFill.style.strokeDashoffset = (C * (1 - progress)).toFixed(1);
        }
      }
    }
  } catch (e) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", prePaintDom);
} else {
  prePaintDom();
}
