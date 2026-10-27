/**
 * Focus Stats & History Manager for Momentum Firefox Extension
 * Provides daily and monthly aggregation, top-right widget & popover with smooth sliding history
 * (matching Image spec), visual charts, and session logs.
 */

class StatsManager {
  constructor() {
    this.modalEl = null;
    this.openBtn = null;
    this.closeBtn = null;

    // Top-right widget & popover elements
    this.topStatsTriggerBtn = null;
    this.topStatsPopover = null;
    this.topFocusedTodayTimeEl = null;
    this.tspCardTitleEl = null;
    this.tspDaysColumnsEl = null;
    this.tspHistoryBtn = null;

    // Slider track & History view elements
    this.sliderViewportEl = null;
    this.sliderTrackEl = null;
    this.viewStatsEl = null;
    this.viewHistoryEl = null;
    this.tshBtnBack = null;
    this.tshMonthLabel = null;
    this.tshMonthFocused = null;
    this.tshDaysList = null;
    this.tshPrevMonth = null;
    this.tshNextMonth = null;

    // Period filter state (7 or 30 days)
    this.currentPeriod = 7;
    this.periodToggleBtn = null;
    this.periodLabelEl = null;
    this.periodDropdownEl = null;
    this.periodOptionBtns = [];

    // Columns scroll & nav buttons
    this.columnsViewportEl = null;
    this.chartNavLeftBtn = null;
    this.chartNavRightBtn = null;
    this.chartWrapperEl = null;
    this.chartTooltipEl = null;
    this.startFocusBtn = null;

    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth() + 1; // 1-12
    this.selectedDateStr = storageService.getTodayDateString(today);

    // History view navigation state
    this.historyYear = today.getFullYear();
    this.historyMonth = today.getMonth() + 1;

    this.extApi = (typeof browser !== "undefined") ? browser : chrome;
  }

  init(elements) {
    this.modalEl = elements.modal;
    this.openBtn = elements.openBtn;
    this.closeBtn = elements.closeBtn;

    // Top-right elements
    this.topStatsTriggerBtn = document.getElementById("btn-top-focus-stats");
    this.topStatsPopover = document.getElementById("top-stats-popover");
    this.topFocusedTodayTimeEl = document.getElementById("top-focused-today-time");
    this.tspCardTitleEl = document.getElementById("tsp-card-focused-label");
    this.tspDaysColumnsEl = document.getElementById("tsp-days-columns");
    this.tspHistoryBtn = document.getElementById("tsp-btn-history");

    // Slider & History View elements
    this.sliderViewportEl = document.getElementById("tsp-slider-viewport");
    this.sliderTrackEl = document.getElementById("tsp-slider-track");
    this.viewStatsEl = document.getElementById("tsp-view-stats");
    this.viewHistoryEl = document.getElementById("tsp-view-history");
    this.tshBtnBack = document.getElementById("tsh-btn-back");
    this.tshMonthLabel = document.getElementById("tsh-month-label");
    this.tshMonthFocused = document.getElementById("tsh-month-focused");
    this.tshDaysList = document.getElementById("tsh-days-list");
    this.tshPrevMonth = document.getElementById("tsh-prev-month");
    this.tshNextMonth = document.getElementById("tsh-next-month");

    // Period dropdown & Chart elements
    this.periodToggleBtn = document.getElementById("tsp-period-toggle");
    this.periodLabelEl = document.getElementById("tsp-period-label");
    this.periodDropdownEl = document.getElementById("tsp-period-dropdown");
    this.periodOptionBtns = Array.from(document.querySelectorAll(".tsp-period-option"));

    this.columnsViewportEl = document.getElementById("tsp-columns-viewport");
    this.chartNavLeftBtn = document.getElementById("tsp-chart-nav-left");
    this.chartNavRightBtn = document.getElementById("tsp-chart-nav-right");
    this.chartWrapperEl = document.getElementById("tsp-chart-wrapper");
    this.chartTooltipEl = document.getElementById("tsp-chart-tooltip");
    this.startFocusBtn = document.getElementById("tsp-btn-start-focus");

    this.bindEvents();
    this.bindTopWidgetEvents();
    this.setupStorageListener();

    // Clean out any legacy demo stats so only real focus data is displayed
    storageService.cleanDemoStats().then(() => {
      this.updateTopWidget();
    });
  }

  bindEvents() {
    if (this.openBtn) {
      this.openBtn.addEventListener("click", () => this.open());
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", () => this.close());
    }
    if (this.modalEl) {
      this.modalEl.addEventListener("click", (e) => {
        if (e.target === this.modalEl) this.close();
      });
    }

    // Escape key closes modal & popovers
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.modalEl && !this.modalEl.classList.contains("hidden")) {
          this.close();
        }
        if (this.topStatsPopover && !this.topStatsPopover.classList.contains("hidden")) {
          this.closeTopPopover();
        }
      }
    });
  }

  calculateViewHeight(viewIndex = 1) {
    if (viewIndex === 1) {
      const view = this.viewStatsEl;
      if (!view) return 335;
      const footer = view.querySelector(".tsp-footer");
      if (footer) {
        const viewRect = view.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const measured = Math.ceil(footerRect.bottom - viewRect.top);
        if (measured > 150) return measured;
      }
      return 335;
    } else {
      const view = this.viewHistoryEl;
      if (!view) return 460;
      const daysList = view.querySelector("#tsh-days-list");
      if (daysList) {
        const viewRect = view.getBoundingClientRect();
        const listRect = daysList.getBoundingClientRect();
        const measured = Math.ceil(listRect.bottom - viewRect.top);
        if (measured > 200) return measured;
      }
      return Math.max(view.scrollHeight, 460);
    }
  }

  updateViewportHeight(viewIndex = 1) {
    if (!this.sliderViewportEl) return;
    const h = this.calculateViewHeight(viewIndex);
    if (h > 0) {
      this.sliderViewportEl.style.height = `${h}px`;
    }
  }

  bindTopWidgetEvents() {
    // Toggle Top-Right Popover from Focus Mode calendar icon
    const fsCalendarBtn = document.getElementById("focus-fs-btn-calendar");
    if (fsCalendarBtn && this.topStatsPopover) {
      fsCalendarBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const isHidden = this.topStatsPopover.classList.contains("hidden");
        this.topStatsPopover.classList.toggle("hidden", !isHidden);
        if (isHidden) {
          if (this.sliderTrackEl) {
            this.sliderTrackEl.classList.remove("slide-history");
          }
          await this.renderChart(this.currentPeriod);
          this.updateViewportHeight(1);
        }
      });
    }

    // Toggle Top-Right Popover
    if (this.topStatsTriggerBtn && this.topStatsPopover) {
      this.topStatsTriggerBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const isHidden = this.topStatsPopover.classList.contains("hidden");
        this.topStatsPopover.classList.toggle("hidden", !isHidden);
        this.topStatsTriggerBtn.classList.toggle("active", isHidden);
        if (isHidden) {
          if (this.sliderTrackEl) {
            this.sliderTrackEl.classList.remove("slide-history");
          }
          await this.renderChart(this.currentPeriod);
          this.updateViewportHeight(1);
        }
      });

      // Close popover when clicking outside
      document.addEventListener("click", (e) => {
        const container = document.querySelector(".top-stats-widget-container");
        if (container && !container.contains(e.target)) {
          this.closeTopPopover();
        }
      });
    }

    // Period filter dropdown (Last 7 days vs Last 30 days)
    if (this.periodToggleBtn && this.periodDropdownEl) {
      this.periodToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isClosed = this.periodDropdownEl.classList.contains("hidden");
        this.periodDropdownEl.classList.toggle("hidden", !isClosed);
      });

      document.addEventListener("click", (e) => {
        if (this.periodDropdownEl && !this.periodDropdownEl.contains(e.target) && e.target !== this.periodToggleBtn) {
          this.periodDropdownEl.classList.add("hidden");
        }
      });

      this.periodOptionBtns.forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const period = parseInt(btn.dataset.period, 10) || 7;
          this.currentPeriod = period;

          this.periodOptionBtns.forEach((b) => b.classList.toggle("active", b === btn));
          if (this.periodLabelEl) {
            this.periodLabelEl.textContent = (period === 30 ? "Last 30 days" : "Last 7 days");
          }
          this.periodDropdownEl.classList.add("hidden");

          await this.renderChart(this.currentPeriod);
          this.updateViewportHeight(1);
        });
      });
    }

    // Mouse wheel scrolling for 30-day mode (scrolling vertically scrolls columns horizontally)
    if (this.columnsViewportEl) {
      this.columnsViewportEl.addEventListener("wheel", (e) => {
        if (this.currentPeriod === 30 && e.deltaY !== 0) {
          e.preventDefault();
          this.columnsViewportEl.scrollLeft += e.deltaY;
          this.updateScrollNavButtons();
          if (this.chartTooltipEl) this.chartTooltipEl.classList.add("hidden");
        }
      }, { passive: false });

      this.columnsViewportEl.addEventListener("scroll", () => {
        this.updateScrollNavButtons();
        if (this.chartTooltipEl) this.chartTooltipEl.classList.add("hidden");
      });
    }

    // Scroll nav buttons (< and >)
    if (this.chartNavLeftBtn && this.columnsViewportEl) {
      this.chartNavLeftBtn.addEventListener("click", () => {
        this.columnsViewportEl.scrollBy({ left: -140, behavior: "smooth" });
      });
    }
    if (this.chartNavRightBtn && this.columnsViewportEl) {
      this.chartNavRightBtn.addEventListener("click", () => {
        this.columnsViewportEl.scrollBy({ left: 140, behavior: "smooth" });
      });
    }

    // Hide tooltip when mouse leaves the chart wrapper
    if (this.chartWrapperEl) {
      this.chartWrapperEl.addEventListener("mouseleave", () => {
        if (this.chartTooltipEl) this.chartTooltipEl.classList.add("hidden");
      });
    }

    // Pill Focus button in header triggers the top-left focus timer
    if (this.startFocusBtn) {
      this.startFocusBtn.addEventListener("click", () => {
        this.closeTopPopover();
        const topLeftFocus = document.getElementById("btn-toggle-focus") || document.getElementById("btn-top-focus");
        if (topLeftFocus) topLeftFocus.click();
      });
    }

    // History button slides content smoothly to the left
    if (this.tspHistoryBtn && this.sliderTrackEl) {
      this.tspHistoryBtn.addEventListener("click", async () => {
        if (this.chartTooltipEl) this.chartTooltipEl.classList.add("hidden");
        await this.renderHistoryView();
        this.sliderTrackEl.classList.add("slide-history");
        this.updateViewportHeight(2);
      });
    }

    // Back button in History view slides content smoothly back to the right
    if (this.tshBtnBack && this.sliderTrackEl) {
      this.tshBtnBack.addEventListener("click", () => {
        this.sliderTrackEl.classList.remove("slide-history");
        this.updateViewportHeight(1);
        this.updateScrollNavButtons();
      });
    }

    // Month Navigation inside History view
    if (this.tshPrevMonth) {
      this.tshPrevMonth.addEventListener("click", async () => {
        if (this.historyMonth === 1) {
          this.historyMonth = 12;
          this.historyYear -= 1;
        } else {
          this.historyMonth -= 1;
        }
        await this.renderHistoryView();
        this.updateViewportHeight(2);
      });
    }

    if (this.tshNextMonth) {
      this.tshNextMonth.addEventListener("click", async () => {
        if (this.historyMonth === 12) {
          this.historyMonth = 1;
          this.historyYear += 1;
        } else {
          this.historyMonth += 1;
        }
        await this.renderHistoryView();
        this.updateViewportHeight(2);
      });
    }
  }

  updateScrollNavButtons() {
    if (!this.columnsViewportEl) return;
    if (this.currentPeriod !== 30) {
      if (this.chartNavLeftBtn) this.chartNavLeftBtn.classList.add("hidden");
      if (this.chartNavRightBtn) this.chartNavRightBtn.classList.add("hidden");
      return;
    }

    const maxScroll = this.columnsViewportEl.scrollWidth - this.columnsViewportEl.clientWidth;
    const currentScroll = this.columnsViewportEl.scrollLeft;

    if (this.chartNavLeftBtn) {
      this.chartNavLeftBtn.classList.toggle("hidden", currentScroll <= 6);
    }
    if (this.chartNavRightBtn) {
      this.chartNavRightBtn.classList.toggle("hidden", currentScroll >= maxScroll - 6);
    }
  }

  closeTopPopover() {
    if (this.topStatsPopover) {
      this.topStatsPopover.classList.add("hidden");
    }
    if (this.topStatsTriggerBtn) {
      this.topStatsTriggerBtn.classList.remove("active");
    }
    if (this.periodDropdownEl) {
      this.periodDropdownEl.classList.add("hidden");
    }
    if (this.chartTooltipEl) {
      this.chartTooltipEl.classList.add("hidden");
    }
    // Reset slide position immediately
    if (this.sliderTrackEl) {
      this.sliderTrackEl.classList.remove("slide-history");
    }
    // Clear inline height so viewport defaults cleanly to auto without retaining View 2 height
    if (this.sliderViewportEl) {
      this.sliderViewportEl.style.height = "";
    }
  }

  setupStorageListener() {
    if (this.extApi && this.extApi.storage && this.extApi.storage.onChanged) {
      this.extApi.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.focus_stats) {
          this.updateTopWidget();
          if (this.sliderTrackEl && this.sliderTrackEl.classList.contains("slide-history")) {
            this.renderHistoryView().then(() => this.updateViewportHeight(2));
          }
          if (this.modalEl && !this.modalEl.classList.contains("hidden")) {
            this.render();
          }
        }
      });
    }
  }

  formatDuration(minutes) {
    if (!minutes || minutes <= 0) return "0m";
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    if (hours === 0) return `${remMins}m`;
    if (remMins === 0) return `${hours}h`;
    return `${hours}h ${remMins}m`;
  }

  async updateTopWidget() {
    const todayStr = storageService.getTodayDateString();
    let todayStats = null;
    if (typeof window !== "undefined" && window.momentumDB) {
      todayStats = await window.momentumDB.getDayStats(todayStr);
    } else {
      todayStats = await storageService.getStatsByDate(todayStr);
    }
    const formatted = this.formatDuration(todayStats.totalMinutes);

    if (this.topFocusedTodayTimeEl) {
      this.topFocusedTodayTimeEl.textContent = formatted;
    }

    // Dynamic target circle progress for the top-right trigger widget
    const ringEl = document.querySelector(".top-stats-ring");
    if (ringEl) {
      let targetMins = 120;
      if (typeof window !== "undefined" && window.momentumDB) {
        const settings = await window.momentumDB.getSettings();
        if (settings && settings.focusDuration) targetMins = settings.focusDuration;
      } else {
        const settings = await storageService.getSettings();
        if (settings && settings.focusDuration) targetMins = settings.focusDuration;
      }
      const todayRatio = Math.min(1, (todayStats.totalMinutes || 0) / targetMins);
      const C = 53.4;
      const offset = (C * (1 - todayRatio)).toFixed(1);
      ringEl.replaceChildren();
      const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      bgCircle.setAttribute("cx", "12");
      bgCircle.setAttribute("cy", "12");
      bgCircle.setAttribute("r", "8.5");
      bgCircle.setAttribute("fill", "none");
      bgCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.3)");
      bgCircle.setAttribute("stroke-width", "2.6");
      ringEl.appendChild(bgCircle);

      if (todayRatio > 0) {
        const fgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        fgCircle.setAttribute("cx", "12");
        fgCircle.setAttribute("cy", "12");
        fgCircle.setAttribute("r", "8.5");
        fgCircle.setAttribute("fill", "none");
        fgCircle.setAttribute("stroke", "#ffffff");
        fgCircle.setAttribute("stroke-width", "2.6");
        fgCircle.setAttribute("stroke-linecap", "round");
        fgCircle.setAttribute("stroke-dasharray", "53.4");
        fgCircle.setAttribute("stroke-dashoffset", String(offset));
        fgCircle.setAttribute("transform", "rotate(-90 12 12)");
        ringEl.appendChild(fgCircle);
      }

      const gridLabels = document.querySelectorAll(".tsp-grid-lines .tsp-grid-label");
      if (gridLabels && gridLabels.length >= 4) {
        gridLabels[0].textContent = this.formatDuration(targetMins);
        gridLabels[1].textContent = this.formatDuration(Math.round(targetMins * 0.75));
        gridLabels[2].textContent = this.formatDuration(Math.round(targetMins * 0.5));
        gridLabels[3].textContent = this.formatDuration(Math.round(targetMins * 0.25));
      }
    }

    await this.renderChart(this.currentPeriod);
    if (this.topStatsPopover && !this.topStatsPopover.classList.contains("hidden") &&
        (!this.sliderTrackEl || !this.sliderTrackEl.classList.contains("slide-history"))) {
      this.updateViewportHeight(1);
    }
  }

  // --- Render Chart: 7 Days or 30 Days with Hover Tooltip Badge ---
  async renderChart(daysCount = this.currentPeriod) {
    if (!this.tspDaysColumnsEl) return;
    this.tspDaysColumnsEl.innerHTML = "";
    if (this.chartTooltipEl) this.chartTooltipEl.classList.add("hidden");

    const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
    const now = new Date();
    let maxMinutes = 120;
    if (typeof window !== "undefined" && window.momentumDB) {
      const settings = await window.momentumDB.getSettings();
      if (settings && settings.focusDuration) maxMinutes = settings.focusDuration;
    } else {
      const settings = await storageService.getSettings();
      if (settings && settings.focusDuration) maxMinutes = settings.focusDuration;
    }
    let totalPeriodMinutes = 0;
    const is30Days = (daysCount === 30);

    // Apply class for layout spacing
    if (is30Days) {
      this.tspDaysColumnsEl.className = "tsp-days-columns mode-30-days";
    } else {
      this.tspDaysColumnsEl.className = "tsp-days-columns mode-7-days";
      if (this.columnsViewportEl) this.columnsViewportEl.scrollLeft = 0;
    }

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = storageService.getTodayDateString(d);
      const dayData = await storageService.getStatsByDate(dateStr);
      const isToday = (i === 0);

      totalPeriodMinutes += (dayData.totalMinutes || 0);

      const col = document.createElement("div");
      col.className = `tsp-day-col ${isToday ? "is-today" : ""}`;
      col.setAttribute("data-minutes", dayData.totalMinutes || 0);

      const barContainer = document.createElement("div");
      barContainer.className = "tsp-day-bar-container";

      if (dayData.totalMinutes > 0) {
        const bar = document.createElement("div");
        bar.className = "tsp-active-bar";
        const heightPct = Math.min(100, Math.max(8, Math.round((dayData.totalMinutes / maxMinutes) * 100)));
        bar.style.height = `${heightPct}%`;
        barContainer.appendChild(bar);
      } else {
        const dash = document.createElement("div");
        dash.className = "tsp-dash-tick";
        barContainer.appendChild(dash);
      }

      // X-Axis label: Day letters in 7-day mode, Date numbers in 30-day mode
      const labelEl = document.createElement("span");
      if (is30Days) {
        labelEl.className = "tsp-day-num";
        labelEl.textContent = d.getDate(); // e.g. 6, 7, ... 23
      } else {
        labelEl.className = "tsp-day-letter";
        labelEl.textContent = dayLabels[d.getDay()]; // e.g. S, M, T
      }

      col.appendChild(barContainer);
      col.appendChild(labelEl);

      // Hover event to display floating white tooltip badge (matching user image)
      col.addEventListener("mouseenter", () => {
        const chartWrapper = this.chartWrapperEl || document.getElementById("tsp-chart-wrapper");
        const tooltip = this.chartTooltipEl || document.getElementById("tsp-chart-tooltip");
        if (!chartWrapper || !tooltip) return;

        const targetEl = col.querySelector(".tsp-active-bar, .tsp-dash-tick");
        if (!targetEl) return;

        const wrapRect = chartWrapper.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        let centerX, topY;
        if (wrapRect.width > 0 && targetRect.width > 0) {
          // Precise screen-relative coordinates centered directly over the bar
          centerX = (targetRect.left + targetRect.width / 2) - wrapRect.left;
          topY = targetRect.top - wrapRect.top - 6;
        } else {
          // Deterministic DOM offset fallback
          const viewport = this.columnsViewportEl || document.getElementById("tsp-columns-viewport");
          const scrollOffset = viewport ? viewport.scrollLeft : 0;
          const viewportLeft = viewport ? viewport.offsetLeft : 36;
          centerX = viewportLeft + col.offsetLeft + (col.offsetWidth / 2) - scrollOffset;
          const barHeight = targetEl.offsetHeight || 0;
          const barTop = 120 - barHeight;
          topY = barTop - 6;
        }

        tooltip.textContent = this.formatDuration(dayData.totalMinutes);
        tooltip.style.left = `${Math.round(centerX)}px`;
        tooltip.style.top = `${Math.round(topY)}px`;
        tooltip.classList.remove("hidden");
      });

      col.addEventListener("mouseleave", () => {
        const tooltip = this.chartTooltipEl || document.getElementById("tsp-chart-tooltip");
        if (tooltip) tooltip.classList.add("hidden");
      });

      this.tspDaysColumnsEl.appendChild(col);
    }

    // Update total focus time in card title for this period
    if (this.tspCardTitleEl) {
      this.tspCardTitleEl.textContent = `${this.formatDuration(totalPeriodMinutes)} focused`;
    }

    // Scroll to far right in 30 days mode so latest day is in view
    if (is30Days && this.columnsViewportEl) {
      requestAnimationFrame(() => {
        this.columnsViewportEl.scrollLeft = this.columnsViewportEl.scrollWidth;
        this.updateScrollNavButtons();
      });
    } else {
      this.updateScrollNavButtons();
    }
  }

  // --- Render Sliding Focus History View (Matching Image) ---
  async renderHistoryView() {
    const monthStats = await storageService.getStatsByMonth(this.historyYear, this.historyMonth);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    if (this.tshMonthLabel) {
      this.tshMonthLabel.textContent = `${months[this.historyMonth - 1]} ${this.historyYear}`;
    }

    if (this.tshMonthFocused) {
      this.tshMonthFocused.textContent = `${this.formatDuration(monthStats.totalMinutes)} focused`;
    }

    if (this.tshDaysList) {
      this.tshDaysList.innerHTML = "";

      const now = new Date();
      const isCurrentMonth = (now.getFullYear() === this.historyYear && (now.getMonth() + 1) === this.historyMonth);
      const daysInMonth = new Date(this.historyYear, this.historyMonth, 0).getDate();
      const startDay = isCurrentMonth ? now.getDate() : daysInMonth;

      // Populate list descending from startDay down to 1
      let targetMinutes = 120;
      if (typeof window !== "undefined" && window.momentumDB) {
        const s = await window.momentumDB.getSettings();
        if (s && s.focusDuration) targetMinutes = s.focusDuration;
      } else {
        const s = await storageService.getSettings();
        if (s && s.focusDuration) targetMinutes = s.focusDuration;
      }
      const targetLabel = this.formatDuration(targetMinutes);

      for (let day = startDay; day >= 1; day--) {
        const d = new Date(this.historyYear, this.historyMonth - 1, day);
        const dayKey = `${this.historyYear}-${String(this.historyMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const dayData = monthStats.days[dayKey] || { totalMinutes: 0 };

        const row = document.createElement("div");
        row.className = "tsh-row";

        const weekdayName = weekdays[d.getDay()];
        const monthName = months[d.getMonth()];
        const dateText = `${weekdayName} ${monthName} ${day}`;

        const leftSpan = document.createElement("span");
        leftSpan.className = "tsh-row-date";
        leftSpan.textContent = dateText;

        const rightDiv = document.createElement("div");
        rightDiv.className = "tsh-row-right";

        const C = 53.4;

        if (dayData.totalMinutes > 0) {
          const timeSpan = document.createElement("span");
          timeSpan.className = "tsh-row-time";
          timeSpan.textContent = this.formatDuration(dayData.totalMinutes);

          // Calculate percentage fill based on daily target goal
          const ratio = Math.min(1, dayData.totalMinutes / targetMinutes);
          const offset = (C * (1 - ratio)).toFixed(1);
          const pctText = `${Math.round(ratio * 100)}% of ${targetLabel} goal`;

          // Progress ring filled proportionally according to 10h goal
          const ringSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          ringSvg.setAttribute("class", "tsh-row-ring has-time");
          ringSvg.setAttribute("width", "16");
          ringSvg.setAttribute("height", "16");
          ringSvg.setAttribute("viewBox", "0 0 24 24");
          ringSvg.setAttribute("title", pctText);

          const bgCirc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          bgCirc.setAttribute("cx", "12");
          bgCirc.setAttribute("cy", "12");
          bgCirc.setAttribute("r", "8.5");
          bgCirc.setAttribute("fill", "none");
          bgCirc.setAttribute("stroke", "rgba(255, 255, 255, 0.22)");
          bgCirc.setAttribute("stroke-width", "2.5");
          ringSvg.appendChild(bgCirc);

          const fgCirc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          fgCirc.setAttribute("cx", "12");
          fgCirc.setAttribute("cy", "12");
          fgCirc.setAttribute("r", "8.5");
          fgCirc.setAttribute("fill", "none");
          fgCirc.setAttribute("stroke", "#ffffff");
          fgCirc.setAttribute("stroke-width", "2.5");
          fgCirc.setAttribute("stroke-linecap", "round");
          fgCirc.setAttribute("stroke-dasharray", "53.4");
          fgCirc.setAttribute("stroke-dashoffset", String(offset));
          fgCirc.setAttribute("transform", "rotate(-90 12 12)");
          ringSvg.appendChild(fgCirc);

          rightDiv.appendChild(timeSpan);
          rightDiv.appendChild(ringSvg);
        } else {
          const dashSpan = document.createElement("span");
          dashSpan.className = "tsh-row-dash";
          dashSpan.textContent = "—";

          // Empty ring icon (0% target)
          const ringSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          ringSvg.setAttribute("class", "tsh-row-ring");
          ringSvg.setAttribute("width", "16");
          ringSvg.setAttribute("height", "16");
          ringSvg.setAttribute("viewBox", "0 0 24 24");
          ringSvg.setAttribute("title", "0% of 10h target");

          const emptyCirc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          emptyCirc.setAttribute("cx", "12");
          emptyCirc.setAttribute("cy", "12");
          emptyCirc.setAttribute("r", "8.5");
          emptyCirc.setAttribute("fill", "none");
          emptyCirc.setAttribute("stroke", "rgba(255, 255, 255, 0.22)");
          emptyCirc.setAttribute("stroke-width", "2.5");
          ringSvg.appendChild(emptyCirc);

          rightDiv.appendChild(dashSpan);
          rightDiv.appendChild(ringSvg);
        }

        row.appendChild(leftSpan);
        row.appendChild(rightDiv);
        this.tshDaysList.appendChild(row);
      }
    }
  }

  // --- Full History Modal Methods ---
  async open() {
    if (!this.modalEl) return;
    this.modalEl.classList.remove("hidden");
    await this.render();
  }

  close() {
    if (!this.modalEl) return;
    this.modalEl.classList.add("hidden");
  }

  async render() {
    await this.renderMonthlyOverview();
    await this.renderDailyDetails();
  }

  async renderMonthlyOverview() {
    const monthStats = await storageService.getStatsByMonth(this.currentYear, this.currentMonth);
    const monthTitleEl = document.getElementById("stats-month-title");
    const monthTotalMinsEl = document.getElementById("stats-month-mins");
    const monthSessionsEl = document.getElementById("stats-month-sessions");
    const monthActiveDaysEl = document.getElementById("stats-month-active-days");
    const chartContainer = document.getElementById("stats-chart-bars");

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    if (monthTitleEl) {
      monthTitleEl.textContent = `${monthNames[this.currentMonth - 1]}, ${this.currentYear}`;
    }

    const totalHours = Math.floor(monthStats.totalMinutes / 60);
    const remMins = monthStats.totalMinutes % 60;
    if (monthTotalMinsEl) {
      monthTotalMinsEl.textContent = `${totalHours}h ${remMins}m`;
    }
    if (monthSessionsEl) {
      monthSessionsEl.textContent = `${monthStats.totalSessions}`;
    }
    if (monthActiveDaysEl) {
      monthActiveDaysEl.textContent = `${monthStats.activeDaysCount} ${monthStats.activeDaysCount === 1 ? "day" : "days"}`;
    }

    if (chartContainer) {
      chartContainer.innerHTML = "";
      
      let maxMins = 60;
      for (const dayKey in monthStats.days) {
        if (monthStats.days[dayKey].totalMinutes > maxMins) {
          maxMins = monthStats.days[dayKey].totalMinutes;
        }
      }

      for (const dayKey in monthStats.days) {
        const dayData = monthStats.days[dayKey];
        const dayNum = parseInt(dayKey.split("-")[2], 10);
        const heightPercent = Math.min(100, Math.round((dayData.totalMinutes / maxMins) * 100));

        const barCol = document.createElement("div");
        barCol.className = `chart-col ${dayKey === this.selectedDateStr ? "selected" : ""}`;
        barCol.title = `${dayKey}: ${dayData.totalMinutes}m (${dayData.completedSessions} sessions)`;

        const bar = document.createElement("div");
        bar.className = `chart-bar ${dayData.totalMinutes > 0 ? "has-data" : ""}`;
        bar.style.height = `${Math.max(4, heightPercent)}%`;

        const label = document.createElement("span");
        label.className = "chart-day-label";
        label.textContent = dayNum;

        barCol.appendChild(bar);
        barCol.appendChild(label);

        barCol.addEventListener("click", () => {
          this.selectedDateStr = dayKey;
          this.render();
        });

        chartContainer.appendChild(barCol);
      }
    }

    const prevMonthBtn = document.getElementById("stats-prev-month");
    const nextMonthBtn = document.getElementById("stats-next-month");

    if (prevMonthBtn) {
      prevMonthBtn.onclick = () => {
        if (this.currentMonth === 1) {
          this.currentMonth = 12;
          this.currentYear -= 1;
        } else {
          this.currentMonth -= 1;
        }
        this.render();
      };
    }

    if (nextMonthBtn) {
      nextMonthBtn.onclick = () => {
        if (this.currentMonth === 12) {
          this.currentMonth = 1;
          this.currentYear += 1;
        } else {
          this.currentMonth += 1;
        }
        this.render();
      };
    }
  }

  async renderDailyDetails() {
    const dailyData = await storageService.getStatsByDate(this.selectedDateStr);
    const dayDateHeading = document.getElementById("stats-day-heading");
    const daySummaryEl = document.getElementById("stats-day-summary");
    const timelineListEl = document.getElementById("stats-timeline-list");

    const todayStr = storageService.getTodayDateString();
    const isToday = this.selectedDateStr === todayStr;

    if (dayDateHeading) {
      dayDateHeading.textContent = isToday ? `Today (${this.selectedDateStr})` : `Date ${this.selectedDateStr}`;
    }

    if (daySummaryEl) {
      const dHours = Math.floor(dailyData.totalMinutes / 60);
      const dMins = dailyData.totalMinutes % 60;
      daySummaryEl.textContent = `Total: ${dHours > 0 ? `${dHours}h ` : ""}${dMins}m • ${dailyData.completedSessions} completed sessions`;
    }

    if (timelineListEl) {
      timelineListEl.innerHTML = "";

      if (!dailyData.sessions || dailyData.sessions.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "empty-sessions";
        const emptySpan = document.createElement("span");
        emptySpan.textContent = "No focus sessions recorded on this day.";
        emptyDiv.appendChild(emptySpan);
        timelineListEl.appendChild(emptyDiv);
        return;
      }

      dailyData.sessions.slice().reverse().forEach((session) => {
        const item = document.createElement("div");
        item.className = "session-card";

        const startTime = new Date(session.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const endTime = new Date(session.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const left = document.createElement("div");
        left.className = "session-card-left";

        const badge = document.createElement("div");
        badge.className = "session-badge";
        badge.textContent = `🎯 ${session.duration}m`;

        const taskInfo = document.createElement("div");
        taskInfo.className = "session-task-info";

        const title = document.createElement("div");
        title.className = "session-task-title";
        title.textContent = session.task || "Focus Session";

        const timeRange = document.createElement("div");
        timeRange.className = "session-time-range";
        timeRange.textContent = `Start: ${startTime} — End: ${endTime}`;

        taskInfo.appendChild(title);
        taskInfo.appendChild(timeRange);
        left.appendChild(badge);
        left.appendChild(taskInfo);

        const statusTag = document.createElement("div");
        statusTag.className = "session-status-tag";
        statusTag.textContent = "Completed";

        item.appendChild(left);
        item.appendChild(statusTag);
        timelineListEl.appendChild(item);
      });
    }
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

const statsManager = new StatsManager();
window.statsManager = statsManager;
