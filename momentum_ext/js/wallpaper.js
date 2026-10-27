/**
 * Wallpaper Manager for Momentum Firefox Extension
 * Loads backgrounds from assets/background/index.json
 * Rotates daily at exactly 5:00 AM (Momentum standard day boundary).
 * Preloads images to eliminate flickering and provides photo credit.
 */

class WallpaperManager {
  constructor() {
    this.container = null;
    this.locationEl = null;
    this.currentUrl = null;
    this.currentEffectiveDate = null;
    this.backgrounds = [];
    this.timerId = null;
    this.extApi = (typeof browser !== "undefined") ? browser : (typeof chrome !== "undefined" ? chrome : null);
  }

  async init(containerElement, locationElement = null) {
    this.container = containerElement;
    this.locationEl = locationElement || document.getElementById("wallpaper-location");

    // Fast-path: Synchronous cache render for 0ms initial paint
    try {
      if (typeof localStorage !== "undefined") {
        const cachedUrl = localStorage.getItem("momentum_cache_wallpaper");
        if (cachedUrl && this.container) {
          this.container.style.backgroundImage = `url("${cachedUrl}")`;
          this.container.classList.add("loaded");
        }
      }
    } catch (e) {}

    // 1. Load background library from assets/background/index.json
    await this.loadBackgroundsLibrary();

    // 2. Load today's wallpaper based on 5:00 AM day boundary
    await this.loadTodayWallpaper();

    // 3. Schedule automatic switch at next 5:00 AM
    this.scheduleNext5AMChange();

    // 4. Listen for tab visibility / focus changes (e.g. computer wakes from sleep)
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this.checkIfDateChanged();
      }
    });

    window.addEventListener("focus", () => {
      this.checkIfDateChanged();
    });

    // 5. Listen for background alarm messages
    if (this.extApi && this.extApi.runtime && this.extApi.runtime.onMessage) {
      this.extApi.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === "WALLPAPER_5AM_UPDATE") {
          console.log("[Wallpaper] Received 5:00 AM broadcast signal from background script.");
          this.loadTodayWallpaper();
          this.scheduleNext5AMChange();
        }
      });
    }
  }

  async loadBackgroundsLibrary() {
    try {
      const url = this.extApi && this.extApi.runtime && this.extApi.runtime.getURL 
        ? this.extApi.runtime.getURL("assets/background/index.json") 
        : "assets/background/index.json";

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        this.backgrounds = (data && Array.isArray(data.history)) ? data.history : [];
        console.log(`[Wallpaper] Loaded ${this.backgrounds.length} backgrounds from index.json`);
      }
    } catch (err) {
      console.warn("Could not load assets/background/index.json, using fallback:", err);
      this.backgrounds = [];
    }
  }

  /**
   * Momentum Standard: Daily rollover occurs at 5:00 AM.
   * - Hours 00:00 to 04:59:59 belong to the previous day.
   * - Hours 05:00:00 to 23:59:59 belong to the current day.
   */
  getEffectiveDate(date = new Date()) {
    const d = new Date(date);
    if (d.getHours() < 5) {
      d.setDate(d.getDate() - 1);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Milliseconds remaining until the next 5:00:00 AM
   */
  getMsUntilNext5AM(now = new Date()) {
    const next5AM = new Date(now);
    if (now.getHours() >= 5) {
      next5AM.setDate(next5AM.getDate() + 1);
    }
    next5AM.setHours(5, 0, 0, 0);
    return Math.max(1000, next5AM.getTime() - now.getTime());
  }

  scheduleNext5AMChange() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const msUntil5AM = this.getMsUntilNext5AM();
    const hours = (msUntil5AM / 3600000).toFixed(2);
    console.log(`[Wallpaper] Next background change scheduled in ${hours} hours (at 5:00 AM).`);

    this.timerId = setTimeout(() => {
      console.log("[Wallpaper] 5:00 AM reached! Switching daily wallpaper...");
      this.loadTodayWallpaper();
      this.scheduleNext5AMChange();
    }, msUntil5AM);
  }

  checkIfDateChanged() {
    const newEffectiveDate = this.getEffectiveDate();
    if (newEffectiveDate !== this.currentEffectiveDate) {
      console.log(`[Wallpaper] Date changed from ${this.currentEffectiveDate} to ${newEffectiveDate}. Updating wallpaper...`);
      this.loadTodayWallpaper();
      this.scheduleNext5AMChange();
    }
  }

  async loadTodayWallpaper() {
    const effectiveDate = this.getEffectiveDate();
    this.currentEffectiveDate = effectiveDate;

    // Check if user selected an active wallpaper
    if (window.momentumDB) {
      try {
        const activeWp = await window.momentumDB.getActiveWallpaper();
        if (activeWp) {
          if (activeWp.source === "my-photos") {
            const photoRecord = await window.momentumDB.getStoreItem("photos", activeWp.id);
            if (photoRecord && photoRecord.blob) {
              const blobUrl = URL.createObjectURL(photoRecord.blob);
              this.applyWallpaper(blobUrl, { title: activeWp.title || "My Photo", isCustom: true });
              return;
            } else if (activeWp.previewUrl || activeWp.thumbnailUrl) {
              this.applyWallpaper(activeWp.previewUrl || activeWp.thumbnailUrl, { title: activeWp.title || "My Photo", isCustom: true });
              return;
            }
          } else if (activeWp.previewUrl && (!activeWp.activeDate || activeWp.activeDate === effectiveDate)) {
            this.applyWallpaper(activeWp.previewUrl, activeWp);
            return;
          }
        }
      } catch (err) {
        console.warn("[Wallpaper] Error checking active wallpaper:", err);
      }
    }

    // Find wallpaper matching effective date
    let selectedBg = null;

    if (this.backgrounds && this.backgrounds.length > 0) {
      // 1. Exact match by date
      selectedBg = this.backgrounds.find(bg => bg.for_date === effectiveDate || bg.display_date === effectiveDate);

      // 2. Deterministic sequential rotation for future or unlisted dates
      if (!selectedBg) {
        const baseDate = new Date(2026, 9, 23, 5, 0, 0); // Oct 23, 2026
        const parts = effectiveDate.split("-").map(Number);
        const targetDate = new Date(parts[0], parts[1] - 1, parts[2], 5, 0, 0);
        const diffDays = Math.round((targetDate - baseDate) / (1000 * 60 * 60 * 24));
        const index = ((diffDays % this.backgrounds.length) + this.backgrounds.length) % this.backgrounds.length;
        selectedBg = this.backgrounds[index];
      }
    }

    if (selectedBg && selectedBg.preview_url) {
      this.applyWallpaper(selectedBg.preview_url, selectedBg);
    } else {
      // Fallback to default
      const fallbackUrl = (typeof DEFAULT_WALLPAPERS !== "undefined" && DEFAULT_WALLPAPERS[0])
        ? DEFAULT_WALLPAPERS[0]
        : "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2560&q=85";
      this.applyWallpaper(fallbackUrl, { title: "Momentum", sourceUrl: "#" });
    }
  }

  applyWallpaper(url, metadata = {}) {
    if (!this.container) {
      this.container = document.getElementById("background-layer");
    }
    if (!this.container || !url) return;
    this.currentUrl = url;

    // Apply immediately to container for instant 0ms visual update
    this.container.style.backgroundImage = `url("${url}")`;
    this.container.classList.add("loaded");
    this.updateLocationInfo(metadata);

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("momentum_cache_wallpaper", url);
      }
    } catch (e) {}

    // Preload image to verify integrity and provide fallback if broken
    const img = new Image();
    img.src = url;

    img.onerror = () => {
      console.warn("Failed to load wallpaper, using fallback:", url);
      const fallbackUrl = (typeof DEFAULT_WALLPAPERS !== "undefined" && DEFAULT_WALLPAPERS[0])
        ? DEFAULT_WALLPAPERS[0]
        : "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2560&q=85";
      if (this.container) {
        this.container.style.backgroundImage = `url("${fallbackUrl}")`;
        this.container.classList.add("loaded");
      }
      this.updateLocationInfo({ title: "Momentum", sourceUrl: "#" });
    };
  }

  updateLocationInfo(metadata) {
    if (!this.locationEl) {
      this.locationEl = document.getElementById("wallpaper-location");
    }
    if (!this.locationEl) return;

    if (metadata && metadata.title) {
      this.locationEl.textContent = metadata.title;
      this.locationEl.title = metadata.attribution || metadata.source || metadata.title;
      this.locationEl.href = metadata.sourceUrl || "#";
      this.locationEl.style.display = "inline-block";
    } else {
      this.locationEl.style.display = "none";
    }
  }

  previewCustomIndex(index) {
    if (!this.backgrounds || this.backgrounds.length === 0) return;
    const safeIndex = Math.abs(index) % this.backgrounds.length;
    const item = this.backgrounds[safeIndex];
    if (item && item.preview_url) {
      this.applyWallpaper(item.preview_url, item);
    }
  }
}

const wallpaperManager = new WallpaperManager();
window.wallpaperManager = wallpaperManager;
