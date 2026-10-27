/**
 * App Entry Point for Momentum Firefox Extension
 * Coordinates initialization of all UI components.
 *
 * P0 resilience rule: every manager initializes INDEPENDENTLY.
 * Previously stats/settings init sat behind
 * `await Promise.all([clock.init(), focus.init()])`, so a single
 * never-settling storage promise inside focus init silently killed
 * the Settings and Stats buttons for the whole session. Now each
 * init runs in its own try/catch, the synchronous listener-binding
 * inits (stats, settings) run immediately, and the async inits are
 * only observed via Promise.allSettled for logging.
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. Wallpaper initialization (fast-path from cache)
  try {
    const bgLayer = document.getElementById("background-layer");
    wallpaperManager.init(bgLayer);
  } catch (e) {
    console.warn("[app] wallpaper init failed:", e);
  }

  // 2. Daily Quote (immediate synchronous pick)
  try {
    initQuote();
  } catch (e) {
    console.warn("[app] quote init failed:", e);
  }

  // 3. Focus Stats initialization — binds its buttons synchronously,
  //    must never wait on clock/focus/storage hydration.
  const statsOpenBtn = document.getElementById("btn-open-stats");
  try {
    statsManager.init({
      modal: document.getElementById("stats-modal"),
      openBtn: statsOpenBtn,
      closeBtn: document.getElementById("btn-close-stats")
    });
  } catch (e) {
    console.warn("[app] stats init failed:", e);
  }

  if (statsOpenBtn) {
    statsOpenBtn.addEventListener("click", () => {
      focusManager.closePopover();
    });
  }

  // 4. Settings Popover initialization — same rule: bind immediately.
  try {
    if (window.settingsManager) {
      settingsManager.init();
    }
  } catch (e) {
    console.warn("[app] settings init failed:", e);
  }

  // 5. Clock & Focus: async hydration, each isolated. A failure or a
  //    hang in one can no longer block the other's UI — their event
  //    listeners are bound synchronously inside their own init(),
  //    before any storage await.
  const asyncInits = [];

  try {
    asyncInits.push(
      Promise.resolve(clockManager.init(
        document.getElementById("clock-time"),
        document.getElementById("greeting-text"),
        document.getElementById("greeting-name")
      )).catch((e) => console.warn("[app] clock init failed:", e))
    );
  } catch (e) {
    console.warn("[app] clock init threw synchronously:", e);
  }

  try {
    asyncInits.push(
      Promise.resolve(focusManager.init({
        timerDisplay: document.getElementById("focus-timer-display"),
        modeBadge: document.getElementById("focus-mode-badge"),
        startBtn: document.getElementById("focus-btn-start"),
        pauseBtn: document.getElementById("focus-btn-pause"),
        resumeBtn: document.getElementById("focus-btn-resume"),
        resetBtn: document.getElementById("focus-btn-reset"),
        skipBtn: document.getElementById("focus-btn-skip")
      })).catch((e) => console.warn("[app] focus init failed:", e))
    );
  } catch (e) {
    console.warn("[app] focus init threw synchronously:", e);
  }

  Promise.allSettled(asyncInits).then((results) => {
    results.forEach((r) => {
      if (r.status === "rejected") {
        console.warn("[app] an init task did not complete cleanly:", r.reason);
      }
    });
  });
});
const QUOTES = [
  { text: "Simplicity is the soul of efficiency.", author: "Austin Freeman" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma" },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" }
];

function initQuote() {
  const quoteText = document.getElementById("quote-text");
  const quoteAuthor = document.getElementById("quote-author");
  if (!quoteText) return;

  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
  const selectedQuote = QUOTES[dayOfYear % QUOTES.length];

  quoteText.textContent = `"${selectedQuote.text}"`;
  if (quoteAuthor) {
    quoteAuthor.textContent = selectedQuote.author;
  }
}
