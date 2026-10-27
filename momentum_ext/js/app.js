/**
 * App Entry Point for Momentum Firefox Extension
 * Coordinates initialization of all UI components.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Wallpaper initialization (fast-path from cache)
  const bgLayer = document.getElementById("background-layer");
  wallpaperManager.init(bgLayer);

  // 2. Daily Quote (immediate synchronous pick)
  initQuote();

  // 3. Concurrently initialize Clock & Focus in parallel (non-blocking)
  const clockTime = document.getElementById("clock-time");
  const greetingText = document.getElementById("greeting-text");
  const greetingName = document.getElementById("greeting-name");

  await Promise.all([
    clockManager.init(clockTime, greetingText, greetingName),
    focusManager.init({
      timerDisplay: document.getElementById("focus-timer-display"),
      modeBadge: document.getElementById("focus-mode-badge"),
      startBtn: document.getElementById("focus-btn-start"),
      pauseBtn: document.getElementById("focus-btn-pause"),
      resumeBtn: document.getElementById("focus-btn-resume"),
      resetBtn: document.getElementById("focus-btn-reset"),
      skipBtn: document.getElementById("focus-btn-skip")
    })
  ]);

  // 4. Focus Stats initialization
  const statsOpenBtn = document.getElementById("btn-open-stats");
  if (statsOpenBtn) {
    statsOpenBtn.addEventListener("click", () => {
      focusManager.closePopover();
    });
  }

  statsManager.init({
    modal: document.getElementById("stats-modal"),
    openBtn: statsOpenBtn,
    closeBtn: document.getElementById("btn-close-stats")
  });

  // 5. Settings Popover initialization
  if (window.settingsManager) {
    settingsManager.init();
  }
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
