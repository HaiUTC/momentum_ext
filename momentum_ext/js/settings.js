/**
 * Momentum Firefox Extension - Settings Popover Manager
 * Controls the 2-column Settings Popover:
 * - Left Column: Focus Mode & Photos Sidebar navigation
 * - Right Column:
 *    1. Focus Mode Pane: Focus Duration (1h-12h, step 30m) & Time Break (5m-30m, step 1m) sliders
 *    2. Photos Pane: [MY PHOTOS] [HISTORY] subtabs, [+ Add Photo] button, and 4-column photo grid
 */

class SettingsManager {
  constructor() {
    this.isOpen = false;
    this.currentNavTab = "focus"; // "focus" | "photos"
    this.currentPhotoSubtab = "history"; // "history" | "my-photos"
    this.historyPhotos = [];
    this.myPhotos = [];
    this.activePhotoId = null;

    // DOM Elements
    this.popoverEl = null;
    this.openBtn = null;
    this.closeBtn = null;
    this.navItems = [];
    this.panelFocus = null;
    this.panelPhotos = null;

    // Sliders
    this.sliderFocusDuration = null;
    this.badgeFocusDuration = null;
    this.sliderFocusInterval = null;
    this.badgeFocusInterval = null;
    this.sliderBreakDuration = null;
    this.badgeBreakDuration = null;

    // Photos UI
    this.photoSubtabs = [];
    this.photosGrid = null;
    this.btnAddPhoto = null;
    this.inputLocalPhoto = null;
  }

  init() {
    this.popoverEl = document.getElementById("settings-popover");
    this.openBtn = document.getElementById("btn-open-settings");
    this.closeBtn = document.getElementById("btn-close-settings");

    if (!this.popoverEl || !this.openBtn) {
      console.warn("[SettingsManager] Required DOM elements not found.");
      return;
    }

    // Panels & Nav
    this.navItems = Array.from(this.popoverEl.querySelectorAll(".settings-nav-item"));
    this.panelFocus = document.getElementById("settings-panel-focus");
    this.panelPhotos = document.getElementById("settings-panel-photos");

    // Sliders
    this.sliderFocusDuration = document.getElementById("slider-focus-duration");
    this.badgeFocusDuration = document.getElementById("badge-focus-duration");
    this.sliderFocusInterval = document.getElementById("slider-focus-interval");
    this.badgeFocusInterval = document.getElementById("badge-focus-interval");
    this.sliderBreakDuration = document.getElementById("slider-break-duration");
    this.badgeBreakDuration = document.getElementById("badge-break-duration");

    // Photos
    this.photoSubtabs = Array.from(this.popoverEl.querySelectorAll(".settings-photo-subtab"));
    this.photosGrid = document.getElementById("settings-photos-grid");
    this.btnAddPhoto = document.getElementById("btn-add-photo");
    this.inputLocalPhoto = document.getElementById("input-local-photo");

    this.bindEvents();
    this.initSliders();
    this.loadSettings();
    this.loadMyPhotos();
    this.loadHistoryPhotos();
  }

  async loadSettings() {
    try {
      let settings = null;
      if (window.momentumDB) {
        settings = await window.momentumDB.getSettings();
      } else if (window.storageService) {
        settings = await window.storageService.getSettings();
      }
      if (settings) {
        if (this.sliderFocusDuration && settings.focusDuration) {
          this.sliderFocusDuration.value = settings.focusDuration;
          if (this.badgeFocusDuration) {
            this.badgeFocusDuration.textContent = this.formatDurationHours(settings.focusDuration);
          }
        }
        if (this.sliderFocusInterval && settings.focusInterval) {
          this.sliderFocusInterval.value = settings.focusInterval;
          if (this.badgeFocusInterval) {
            this.badgeFocusInterval.textContent = this.formatIntervalDuration(settings.focusInterval);
          }
        }
        if (this.sliderBreakDuration && settings.breakDuration) {
          this.sliderBreakDuration.value = settings.breakDuration;
          if (this.badgeBreakDuration) {
            this.badgeBreakDuration.textContent = `${settings.breakDuration}m`;
          }
        }
        if (settings.activeWallpaper && settings.activeWallpaper.id) {
          this.activePhotoId = settings.activeWallpaper.id;
        }
      }
    } catch (e) {
      console.warn("[SettingsManager] Error loading settings:", e);
    }
  }

  async loadMyPhotos() {
    try {
      if (window.momentumDB) {
        this.myPhotos = await window.momentumDB.getMyPhotos();
      }
    } catch (e) {
      console.warn("[SettingsManager] Error loading my photos:", e);
      this.myPhotos = [];
    }
  }

  bindEvents() {
    // 1. Toggle popover on gear button click
    this.openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // 2. Close on close button click
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    // 3. Close on outside click
    document.addEventListener("click", (e) => {
      if (!this.isOpen) return;
      if (!this.popoverEl.contains(e.target) && !this.openBtn.contains(e.target)) {
        this.close();
      }
    });

    // 4. Close on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });

    // Prevent clicks inside popover from closing it
    this.popoverEl.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // 5. Sidebar Navigation (Focus Mode vs Photos)
    this.navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        this.switchNavTab(tab);
      });
    });

    // 6. Photos Subtabs (History vs My Photos)
    this.photoSubtabs.forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        const subtab = tabBtn.getAttribute("data-subtab");
        this.switchPhotoSubtab(subtab);
      });
    });

    // 7. Add Photo button -> Local file input
    if (this.btnAddPhoto && this.inputLocalPhoto) {
      this.btnAddPhoto.addEventListener("click", () => {
        this.inputLocalPhoto.click();
      });

      this.inputLocalPhoto.addEventListener("change", (e) => {
        this.handleLocalPhotoUpload(e);
      });
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.popoverEl.classList.remove("hidden");
    this.loadSettings();
    this.loadMyPhotos();

    // Close other popovers if open
    if (window.focusManager && typeof window.focusManager.closePopover === "function") {
      window.focusManager.closePopover();
    }
    if (window.soundsManager && typeof window.soundsManager.closePopover === "function") {
      window.soundsManager.closePopover();
    }
  }

  close() {
    this.isOpen = false;
    this.popoverEl.classList.add("hidden");
  }

  switchNavTab(tab) {
    this.currentNavTab = tab;

    // Update sidebar buttons
    this.navItems.forEach((item) => {
      const isTarget = item.getAttribute("data-tab") === tab;
      item.classList.toggle("active", isTarget);
    });

    // Update panels
    if (tab === "focus") {
      if (this.panelFocus) this.panelFocus.classList.remove("hidden");
      if (this.panelPhotos) this.panelPhotos.classList.add("hidden");
    } else if (tab === "photos") {
      if (this.panelFocus) this.panelFocus.classList.add("hidden");
      if (this.panelPhotos) this.panelPhotos.classList.remove("hidden");
      this.renderPhotosGrid();
    }
  }

  switchPhotoSubtab(subtab) {
    this.currentPhotoSubtab = subtab;

    this.photoSubtabs.forEach((btn) => {
      const isTarget = btn.getAttribute("data-subtab") === subtab;
      btn.classList.toggle("active", isTarget);
    });

    this.renderPhotosGrid();
  }

  // =========================================================================
  // Slider Controls (Focus Duration & Break Duration)
  // =========================================================================
  initSliders() {
    if (this.sliderFocusDuration && this.badgeFocusDuration) {
      // 1h to 12h (60 to 720 mins, step 30)
      this.sliderFocusDuration.addEventListener("input", (e) => {
        const mins = parseInt(e.target.value, 10);
        this.badgeFocusDuration.textContent = this.formatDurationHours(mins);
      });
      this.sliderFocusDuration.addEventListener("change", async (e) => {
        const mins = parseInt(e.target.value, 10);
        if (window.momentumDB) {
          await window.momentumDB.updateSettings({ focusDuration: mins });
          const state = await window.momentumDB.getFocusState();
          if (!state.isRunning) {
            const updated = {
              durationMinutes: mins,
              remainingSeconds: mins * 60,
              targetTimestamp: null
            };
            await window.momentumDB.saveFocusState(updated);
            try {
              localStorage.setItem("momentum_cache_focus_state", JSON.stringify({ ...state, ...updated }));
            } catch (err) {}
            if (window.focusManager) {
              await window.focusManager.render();
            }
          }
        }
      });
      // Initial text
      this.badgeFocusDuration.textContent = this.formatDurationHours(parseInt(this.sliderFocusDuration.value, 10));
    }

    if (this.sliderFocusInterval && this.badgeFocusInterval) {
      // 30m to 2h (30 to 120 mins, step 5)
      this.sliderFocusInterval.addEventListener("input", (e) => {
        const mins = parseInt(e.target.value, 10);
        this.badgeFocusInterval.textContent = this.formatIntervalDuration(mins);
      });
      this.sliderFocusInterval.addEventListener("change", async (e) => {
        const mins = parseInt(e.target.value, 10);
        if (window.momentumDB) {
          await window.momentumDB.updateSettings({ focusInterval: mins });
          if (window.focusManager) {
            await window.focusManager.render();
          }
        }
      });
      // Initial text
      this.badgeFocusInterval.textContent = this.formatIntervalDuration(parseInt(this.sliderFocusInterval.value, 10));
    }

    if (this.sliderBreakDuration && this.badgeBreakDuration) {
      // 5 to 30 mins (step 1)
      this.sliderBreakDuration.addEventListener("input", (e) => {
        const mins = parseInt(e.target.value, 10);
        this.badgeBreakDuration.textContent = `${mins}m`;
      });
      this.sliderBreakDuration.addEventListener("change", async (e) => {
        const mins = parseInt(e.target.value, 10);
        if (window.momentumDB) {
          await window.momentumDB.updateSettings({ breakDuration: mins });
          const state = await window.momentumDB.getFocusState();
          if (!state.breakIsRunning) {
            await window.momentumDB.saveFocusState({ breakRemainingSeconds: mins * 60 });
          }
          if (window.focusManager) {
            await window.focusManager.render();
          }
        }
      });
      // Initial text
      this.badgeBreakDuration.textContent = `${this.sliderBreakDuration.value}m`;
    }
  }

  formatIntervalDuration(totalMins) {
    if (totalMins < 60) {
      return `${totalMins}m`;
    }
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (mins === 0) {
      return `${hours}h 00m`;
    }
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }

  formatDurationHours(totalMins) {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (mins === 0) {
      return `${hours}h 00m`;
    }
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }

  // =========================================================================
  // Photos Loading & 4-Column Grid Rendering
  // =========================================================================
  async loadHistoryPhotos() {
    try {
      // Attempt to load from wallpaperManager if already initialized
      if (window.wallpaperManager && Array.isArray(window.wallpaperManager.backgrounds) && window.wallpaperManager.backgrounds.length > 0) {
        this.historyPhotos = window.wallpaperManager.backgrounds;
      } else {
        const extApi = (typeof browser !== "undefined") ? browser : (typeof chrome !== "undefined" ? chrome : null);
        const url = extApi && extApi.runtime && extApi.runtime.getURL
          ? extApi.runtime.getURL("assets/background/index.json")
          : "assets/background/index.json";

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.historyPhotos = (data && Array.isArray(data.history)) ? data.history : [];
        }
      }
    } catch (err) {
      console.warn("[SettingsManager] Failed loading history photos:", err);
      this.historyPhotos = [];
    }

    // Match currently active wallpaper from MomentumDB or screen
    if (window.momentumDB) {
      try {
        const activeWp = await window.momentumDB.getActiveWallpaper();
        if (activeWp && activeWp.id) {
          this.activePhotoId = activeWp.id;
        }
      } catch (e) {}
    }

    if (!this.activePhotoId && window.wallpaperManager && window.wallpaperManager.currentUrl) {
      const currentUrl = window.wallpaperManager.currentUrl;
      const matched = this.historyPhotos.find(p => p.preview_url === currentUrl || p.thumbnail_url === currentUrl);
      if (matched) {
        this.activePhotoId = matched.id || matched._id;
      }
    }

    // Set first photo as active fallback if none selected
    if (!this.activePhotoId && this.historyPhotos.length > 0) {
      this.activePhotoId = this.historyPhotos[0].id || this.historyPhotos[0]._id;
    }

    await this.renderPhotosGrid();
  }

  async renderPhotosGrid() {
    if (!this.photosGrid) return;
    this.photosGrid.innerHTML = "";

    if (window.momentumDB) {
      try {
        const activeWp = await window.momentumDB.getActiveWallpaper();
        if (activeWp && activeWp.id) {
          this.activePhotoId = activeWp.id;
        }
      } catch (e) {}
    }

    if (this.currentPhotoSubtab === "history") {
      this.renderHistoryGrid();
    } else {
      await this.loadMyPhotos();
      this.renderMyPhotosGrid();
    }
  }

  renderHistoryGrid() {
    if (!this.historyPhotos || this.historyPhotos.length === 0) {
      this.photosGrid.replaceChildren();
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "settings-photos-empty";

      const emptySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      emptySvg.setAttribute("class", "settings-empty-icon");
      emptySvg.setAttribute("viewBox", "0 0 24 24");
      emptySvg.setAttribute("fill", "none");
      emptySvg.setAttribute("stroke", "currentColor");
      emptySvg.setAttribute("stroke-width", "1.5");

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", "3");
      rect.setAttribute("y", "3");
      rect.setAttribute("width", "18");
      rect.setAttribute("height", "18");
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");

      const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circ.setAttribute("cx", "8.5");
      circ.setAttribute("cy", "8.5");
      circ.setAttribute("r", "1.5");

      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", "21 15 16 10 5 21");

      emptySvg.appendChild(rect);
      emptySvg.appendChild(circ);
      emptySvg.appendChild(poly);

      const span = document.createElement("span");
      span.className = "settings-empty-text";
      span.textContent = "Loading photos...";

      emptyDiv.appendChild(emptySvg);
      emptyDiv.appendChild(span);
      this.photosGrid.appendChild(emptyDiv);
      return;
    }

    const fragment = document.createDocumentFragment();

    // Display history photos (up to 40 for optimal performance in 4-column grid)
    const displayList = this.historyPhotos.slice(0, 48);

    displayList.forEach((photo, idx) => {
      const photoId = photo.id || photo._id || `photo-${idx}`;
      const isActive = this.activePhotoId === photoId;
      const imgUrl = photo.thumbnail_url || photo.preview_url || "";

      const card = document.createElement("div");
      card.className = `settings-photo-card ${isActive ? "active" : ""}`;
      card.setAttribute("data-id", photoId);
      card.title = photo.title || "Wallpaper";

      const img = document.createElement("img");
      img.className = "settings-photo-img";
      img.src = imgUrl;
      img.alt = photo.title || "Wallpaper";
      img.loading = "lazy";

      const badge = document.createElement("div");
      badge.className = "settings-photo-badge";
      badge.setAttribute("aria-label", "Active Wallpaper");

      const badgeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      badgeSvg.setAttribute("viewBox", "0 0 24 24");
      badgeSvg.setAttribute("fill", "none");
      badgeSvg.setAttribute("stroke", "currentColor");

      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", "20 6 9 17 4 12");
      badgeSvg.appendChild(polyline);
      badge.appendChild(badgeSvg);

      card.appendChild(img);
      card.appendChild(badge);

      card.addEventListener("click", () => {
        this.selectActivePhoto(photoId, card);
      });

      fragment.appendChild(card);
    });

    this.photosGrid.appendChild(fragment);
  }

  renderMyPhotosGrid() {
    if (!this.myPhotos || this.myPhotos.length === 0) {
      this.photosGrid.replaceChildren();

      const emptyDiv = document.createElement("div");
      emptyDiv.className = "settings-photos-empty";

      const emptySvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      emptySvg.setAttribute("class", "settings-empty-icon");
      emptySvg.setAttribute("viewBox", "0 0 24 24");
      emptySvg.setAttribute("fill", "none");
      emptySvg.setAttribute("stroke", "currentColor");
      emptySvg.setAttribute("stroke-width", "1.5");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", "17 8 12 3 7 8");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "12");
      line.setAttribute("y1", "3");
      line.setAttribute("x2", "12");
      line.setAttribute("y2", "15");

      emptySvg.appendChild(path);
      emptySvg.appendChild(poly);
      emptySvg.appendChild(line);

      const span1 = document.createElement("span");
      span1.className = "settings-empty-text";
      span1.textContent = "No photos uploaded yet";

      const span2 = document.createElement("span");
      span2.className = "settings-empty-subtext";
      span2.textContent = 'Click "+ Add Photo" above to upload from your computer';

      emptyDiv.appendChild(emptySvg);
      emptyDiv.appendChild(span1);
      emptyDiv.appendChild(span2);
      this.photosGrid.appendChild(emptyDiv);
      return;
    }

    const fragment = document.createDocumentFragment();

    this.myPhotos.forEach((photo) => {
      const isActive = this.activePhotoId === photo.id;
      const card = document.createElement("div");
      card.className = `settings-photo-card ${isActive ? "active" : ""}`;
      card.setAttribute("data-id", photo.id);
      card.title = photo.name || "My Photo";

      const imgSrc = photo.thumbnailDataUrl || photo.url || "";

      const img = document.createElement("img");
      img.className = "settings-photo-img";
      img.src = imgSrc;
      img.alt = photo.name || "My Photo";

      const badge = document.createElement("div");
      badge.className = "settings-photo-badge";
      badge.setAttribute("aria-label", "Active Wallpaper");

      const badgeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      badgeSvg.setAttribute("viewBox", "0 0 24 24");
      badgeSvg.setAttribute("fill", "none");
      badgeSvg.setAttribute("stroke", "currentColor");

      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", "20 6 9 17 4 12");
      badgeSvg.appendChild(polyline);
      badge.appendChild(badgeSvg);

      card.appendChild(img);
      card.appendChild(badge);

      card.addEventListener("click", () => {
        this.selectActivePhoto(photo.id, card);
      });

      fragment.appendChild(card);
    });

    this.photosGrid.appendChild(fragment);
  }

  async selectActivePhoto(photoId, targetCard) {
    this.activePhotoId = photoId;

    // Update active class across all cards in current grid
    const allCards = this.photosGrid.querySelectorAll(".settings-photo-card");
    allCards.forEach((card) => {
      card.classList.toggle("active", card.getAttribute("data-id") === String(photoId));
    });

    const wpMgr = window.wallpaperManager || (typeof wallpaperManager !== "undefined" ? wallpaperManager : null);

    if (this.currentPhotoSubtab === "history") {
      const selected = this.historyPhotos.find((p) => String(p.id || p._id) === String(photoId));
      if (selected) {
        const previewUrl = selected.preview_url || selected.thumbnail_url || selected.url;
        if (wpMgr && previewUrl) {
          wpMgr.applyWallpaper(previewUrl, selected);
        } else if (previewUrl) {
          const bg = document.getElementById("background-layer");
          if (bg) {
            bg.style.backgroundImage = `url("${previewUrl}")`;
            bg.classList.add("loaded");
          }
          try {
            localStorage.setItem("momentum_cache_wallpaper", previewUrl);
          } catch (e) {}
        }

        if (window.momentumDB) {
          const effectiveDate = (wpMgr && wpMgr.getEffectiveDate) ? wpMgr.getEffectiveDate() : new Date().toISOString().split("T")[0];
          await window.momentumDB.setActiveWallpaper({
            id: photoId,
            source: "history",
            previewUrl: previewUrl,
            thumbnailUrl: selected.thumbnail_url || previewUrl,
            title: selected.title || "Wallpaper",
            activeDate: effectiveDate
          });
        }
      }
    } else {
      const selected = this.myPhotos.find((p) => String(p.id) === String(photoId));
      if (selected) {
        let photoUrl = selected.thumbnailDataUrl;
        if (selected.blob) {
          photoUrl = URL.createObjectURL(selected.blob);
        } else if (window.momentumDB) {
          try {
            const photoRecord = await window.momentumDB.getStoreItem("photos", photoId);
            if (photoRecord && photoRecord.blob) {
              photoUrl = URL.createObjectURL(photoRecord.blob);
            }
          } catch (e) {}
        }

        if (wpMgr && photoUrl) {
          wpMgr.applyWallpaper(photoUrl, { title: selected.name, isCustom: true });
        } else if (photoUrl) {
          const bg = document.getElementById("background-layer");
          if (bg) {
            bg.style.backgroundImage = `url("${photoUrl}")`;
            bg.classList.add("loaded");
          }
          try {
            localStorage.setItem("momentum_cache_wallpaper", photoUrl);
          } catch (e) {}
        }

        if (window.momentumDB) {
          const effectiveDate = (wpMgr && wpMgr.getEffectiveDate) ? wpMgr.getEffectiveDate() : new Date().toISOString().split("T")[0];
          await window.momentumDB.setActiveWallpaper({
            id: photoId,
            source: "my-photos",
            previewUrl: photoUrl,
            thumbnailUrl: selected.thumbnailDataUrl,
            title: selected.name || "My Photo",
            activeDate: effectiveDate
          });
        }
      }
    }
  }

  async handleLocalPhotoUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      if (window.momentumDB) {
        const savedPhoto = await window.momentumDB.addMyPhoto(file);
        this.myPhotos = await window.momentumDB.getMyPhotos();
        this.activePhotoId = savedPhoto.id;

        // Auto select and apply as active wallpaper
        let photoUrl = savedPhoto.thumbnailDataUrl;
        if (savedPhoto.blob) {
          photoUrl = URL.createObjectURL(savedPhoto.blob);
        }
        const wpMgr = window.wallpaperManager || (typeof wallpaperManager !== "undefined" ? wallpaperManager : null);
        if (wpMgr) {
          wpMgr.applyWallpaper(photoUrl, { title: savedPhoto.name, isCustom: true });
        } else {
          const bg = document.getElementById("background-layer");
          if (bg) {
            bg.style.backgroundImage = `url("${photoUrl}")`;
            bg.classList.add("loaded");
          }
          try {
            localStorage.setItem("momentum_cache_wallpaper", photoUrl);
          } catch (e) {}
        }

        const effectiveDate = (wpMgr && wpMgr.getEffectiveDate) ? wpMgr.getEffectiveDate() : new Date().toISOString().split("T")[0];
        await window.momentumDB.setActiveWallpaper({
          id: savedPhoto.id,
          source: "my-photos",
          previewUrl: photoUrl,
          thumbnailUrl: savedPhoto.thumbnailDataUrl,
          title: savedPhoto.name,
          activeDate: effectiveDate
        });
      }
      this.switchPhotoSubtab("my-photos");
      if (this.inputLocalPhoto) {
        this.inputLocalPhoto.value = "";
      }
    } catch (err) {
      console.error("[SettingsManager] Error saving uploaded photo:", err);
    }
  }
}

// Global instance
window.settingsManager = new SettingsManager();
