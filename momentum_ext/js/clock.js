/**
 * Clock & Greeting Manager for Momentum Firefox Extension
 * Handles digital time, time-of-day greetings, and name popover menu with inline editing.
 */

class ClockManager {
  constructor() {
    this.timeEl = null;
    this.greetingTextEl = null;
    this.greetingNameEl = null;
    this.nameWrapperEl = null;
    this.threeDotsBtn = null;
    this.namePopoverEl = null;
    this.editNameBtn = null;

    this.intervalId = null;
    this.is24h = true;
    this.userName = "";
  }

  async init(timeEl, greetingTextEl, greetingNameEl) {
    this.timeEl = timeEl;
    this.greetingTextEl = greetingTextEl;
    this.greetingNameEl = greetingNameEl;

    this.nameWrapperEl = document.getElementById("name-wrapper");
    this.threeDotsBtn = document.getElementById("name-three-dots-btn");
    this.namePopoverEl = document.getElementById("name-popover");
    this.editNameBtn = document.getElementById("btn-edit-name-action");

    // Fast-path: Synchronous render from memory cache immediately (0ms latency)
    const cachedSettings = (typeof window !== "undefined" && window.momentumDB)
      ? window.momentumDB.getSettingsSync()
      : storageService.getSettingsSync();
    this.is24h = cachedSettings.is24h !== false && cachedSettings.clockIs24h !== false;
    this.userName = cachedSettings.userName || "";
    this.updateClock();

    this.setupNameMenu();

    if (!this.intervalId) {
      this.intervalId = setInterval(() => this.updateClock(), 1000);
    }

    // Async hydration: reconcile with persistent MomentumDB in background
    let settings = null;
    if (typeof window !== "undefined" && window.momentumDB) {
      settings = await window.momentumDB.getSettings();
    } else {
      settings = await storageService.getSettings();
    }
    if (settings) {
      const is24h = settings.is24h !== false && settings.clockIs24h !== false;
      if (is24h !== this.is24h || (settings.userName && settings.userName !== this.userName)) {
        this.is24h = is24h;
        this.userName = settings.userName || "";
        this.updateClock();
      }
    }
  }

  updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");

    let formattedTime = "";
    if (this.is24h) {
      formattedTime = `${String(hours).padStart(2, "0")}:${minutes}`;
    } else {
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      formattedTime = `${hours}:${minutes} ${ampm}`;
    }

    if (this.timeEl) {
      this.timeEl.textContent = formattedTime;
    }

    this.updateGreeting(now.getHours());
  }

  updateGreeting(hour) {
    let greeting = "Good day";
    if (hour >= 4 && hour < 12) {
      greeting = "Good morning";
    } else if (hour >= 12 && hour < 18) {
      greeting = "Good afternoon";
    } else {
      greeting = "Good evening";
    }

    if (this.greetingTextEl) {
      this.greetingTextEl.textContent = `${greeting}, `;
    }

    if (this.greetingNameEl && !this.greetingNameEl.isContentEditable) {
      this.greetingNameEl.textContent = this.userName ? `${this.userName}.` : "friend.";
    }
  }

  setupNameMenu() {
    if (!this.threeDotsBtn || !this.namePopoverEl) return;

    // Toggle popover on three-dots click
    this.threeDotsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = this.namePopoverEl.classList.contains("hidden");
      this.namePopoverEl.classList.toggle("hidden", !isHidden);
      this.threeDotsBtn.classList.toggle("active", isHidden);
    });

    // Close popover when clicking anywhere else
    document.addEventListener("click", (e) => {
      if (this.nameWrapperEl && !this.nameWrapperEl.contains(e.target)) {
        this.closeNamePopover();
      }
    });

    // Handle "Edit your name" button click
    if (this.editNameBtn) {
      this.editNameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeNamePopover();
        this.startEditingName();
      });
    }

    // Also support clicking directly on name to edit
    if (this.greetingNameEl) {
      this.greetingNameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeNamePopover();
        this.startEditingName();
      });
    }
  }

  closeNamePopover() {
    if (this.namePopoverEl) {
      this.namePopoverEl.classList.add("hidden");
    }
    if (this.threeDotsBtn) {
      this.threeDotsBtn.classList.remove("active");
    }
  }

  startEditingName() {
    if (!this.greetingNameEl || !this.nameWrapperEl) return;

    this.closeNamePopover();

    // Prevent duplicate input if already editing
    if (this.nameWrapperEl.querySelector(".inline-name-input")) return;

    // Get current name without trailing dot
    let currentName = this.userName || "";
    if (!currentName && this.greetingNameEl.textContent) {
      currentName = this.greetingNameEl.textContent.replace(/\.+$/, "").trim();
      if (currentName === "friend") currentName = "";
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-name-input";
    input.value = currentName;
    input.placeholder = "your name";
    input.autocomplete = "off";
    input.spellcheck = false;

    // Dot span right after input
    const dotSpan = document.createElement("span");
    dotSpan.className = "name-edit-dot";
    dotSpan.textContent = ".";

    // Hide three-dots button while editing
    if (this.threeDotsBtn) {
      this.threeDotsBtn.style.display = "none";
    }

    // Hide static name element
    this.greetingNameEl.style.display = "none";

    // Insert input and dot span
    this.nameWrapperEl.insertBefore(input, this.greetingNameEl);
    this.nameWrapperEl.insertBefore(dotSpan, this.greetingNameEl);

    // Auto-resize input to match text width + underline exactly
    const autoResize = () => {
      let mirror = document.getElementById("name-measure-span");
      if (!mirror) {
        mirror = document.createElement("span");
        mirror.id = "name-measure-span";
        mirror.style.position = "absolute";
        mirror.style.top = "-9999px";
        mirror.style.left = "-9999px";
        mirror.style.visibility = "hidden";
        mirror.style.whiteSpace = "pre";
        document.body.appendChild(mirror);
      }
      const cs = window.getComputedStyle(input);
      mirror.style.fontFamily = cs.fontFamily;
      mirror.style.fontSize = cs.fontSize;
      mirror.style.fontWeight = cs.fontWeight;
      mirror.style.letterSpacing = cs.letterSpacing;
      mirror.textContent = input.value || input.placeholder || "a";
      const textWidth = Math.ceil(mirror.getBoundingClientRect().width);
      input.style.width = `${Math.max(40, textWidth + 4)}px`;
    };

    input.addEventListener("input", autoResize);
    autoResize();

    input.focus();
    input.select();

    let isFinished = false;

    const cleanup = () => {
      input.remove();
      dotSpan.remove();
      this.greetingNameEl.style.display = "";
      if (this.threeDotsBtn) {
        this.threeDotsBtn.style.display = "";
      }
    };

    const save = async () => {
      if (isFinished) return;
      isFinished = true;
      let newName = input.value.trim().replace(/\.+$/, "");
      this.userName = newName;
      if (typeof window !== "undefined" && window.momentumDB) {
        await window.momentumDB.updateSettings({ userName: newName });
      }
      await storageService.setUserName(newName);
      cleanup();
      this.updateGreeting(new Date().getHours());
    };

    const cancel = () => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
    };

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
  }

  set24h(val) {
    this.is24h = val;
    this.updateClock();
  }

  setUserName(name) {
    this.userName = name;
    this.updateGreeting(new Date().getHours());
  }
}

const clockManager = new ClockManager();
window.clockManager = clockManager;
