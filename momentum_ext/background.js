/**
 * Background Service Worker / Script for Momentum Firefox Extension
 * Manages Focus Timer alarms, Native Notifications, and Stats logging.
 */

// Import storage service if in environment that supports importScripts
try {
  importScripts("js/storage.js");
} catch (e) {
  // If modules or already loaded
}

const ALARM_NAME = "momentum_pomodoro_timer";
const BREAK_ALARM_NAME = "momentum_break_timer";
const WALLPAPER_ALARM_NAME = "momentum_5am_wallpaper_sync";

const extApi = (typeof browser !== "undefined") ? browser : chrome;


// Schedule daily 5:00 AM wallpaper rollover alarm
function schedule5AMWallpaperAlarm() {
  const now = new Date();
  const next5AM = new Date(now);
  if (now.getHours() >= 5) {
    next5AM.setDate(next5AM.getDate() + 1);
  }
  next5AM.setHours(5, 0, 0, 0);

  extApi.alarms.create(WALLPAPER_ALARM_NAME, {
    when: next5AM.getTime(),
    periodInMinutes: 1440
  });
}
schedule5AMWallpaperAlarm();

// Listen for alarms
extApi.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === WALLPAPER_ALARM_NAME) {
    // Notify all active tabs to update daily wallpaper at 5:00 AM
    try {
      extApi.runtime.sendMessage({ type: "WALLPAPER_5AM_UPDATE" }).catch(() => {});
    } catch (e) {}
    return;
  }

  // Break Finished Alarm
  if (alarm.name === BREAK_ALARM_NAME) {
    const settings = await storageService.getSettings();
    const breakMins = (settings && settings.breakDuration) ? settings.breakDuration : 5;

    extApi.notifications.create("break_complete_notification", {
      type: "basic",
      iconUrl: extApi.runtime.getURL("icons/icon.svg"),
      title: `☕ ${breakMins}-minute break complete!`,
      message: "Rest time is over! Ready to get back into focus."
    });

    // Reset break state & continuous counter, switch view back to focus
    await storageService.saveFocusState({
      breakIsRunning: false,
      breakRemainingSeconds: breakMins * 60,
      breakUnlocked: false,
      breakAnnounceUntil: null,
      breakEndChimePlayed: false,
      continuousFocusSeconds: 0,
      lastContinuousBase: 0,
      currentTab: "focus"
    });

    try {
      extApi.runtime.sendMessage({ type: "BREAK_COMPLETED_ALARM" }).catch(() => {});
    } catch (e) {}
    return;
  }

  if (alarm.name !== ALARM_NAME) return;

  const state = await storageService.getFocusState();
  const settings = await storageService.getSettings();
  const targetDurationMins = (settings && settings.focusDuration) ? settings.focusDuration : 120;

  // Daily target completed!
  const sessionEndTime = Date.now();
  const totalSecsToday = targetDurationMins * 60;
  await storageService.syncTodayFocusSeconds(totalSecsToday, state.currentTask);

  await storageService.recordCompletedSession({
    start: new Date(state.sessionStartTime || (sessionEndTime - (totalSecsToday * 1000))).toISOString(),
    end: new Date(sessionEndTime).toISOString(),
    duration: targetDurationMins,
    task: state.currentTask || (settings.todayFocus && settings.todayFocus.text) || "Deep Focus Day"
  });

  const targetHours = Math.floor(targetDurationMins / 60);
  const targetRemMins = targetDurationMins % 60;
  const timeDesc = targetHours > 0 ? (targetRemMins ? `${targetHours}h ${targetRemMins}m` : `${targetHours}h`) : `${targetRemMins}m`;

  extApi.notifications.create("focus_complete_notification", {
    type: "basic",
    iconUrl: extApi.runtime.getURL("icons/icon.svg"),
    title: "🎯 Focus goal reached today!",
    message: `Awesome! You have completed your ${timeDesc} daily focus goal.`
  });

  await storageService.saveFocusState({
    isRunning: false,
    remainingSeconds: 0,
    targetTimestamp: null,
    sessionStartTime: null
  });
});

// Listen for messages from tabs
extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "START_FOCUS": {
        const state = await storageService.getFocusState();
        const settings = await storageService.getSettings();
        const targetDuration = message.duration || (settings && settings.focusDuration ? settings.focusDuration : 120);
        const remaining = (typeof message.duration === "number")
          ? message.duration * 60
          : ((typeof state.remainingSeconds === "number" && state.remainingSeconds > 0) ? state.remainingSeconds : targetDuration * 60);
        const targetTimestamp = Date.now() + remaining * 1000;

        await extApi.alarms.clear(ALARM_NAME);
        await extApi.alarms.create(ALARM_NAME, { when: targetTimestamp });

        const newState = await storageService.saveFocusState({
          mode: "focus",
          isRunning: true,
          durationMinutes: targetDuration,
          remainingSeconds: remaining,
          targetTimestamp: targetTimestamp,
          sessionStartTime: Date.now(),
          currentTask: (typeof message.task !== "undefined") ? message.task : (state.currentTask || "")
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "UPDATE_FOCUS_TASK": {
        const newState = await storageService.saveFocusState({
          currentTask: message.task || ""
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "PAUSE_TIMER": {
        await extApi.alarms.clear(ALARM_NAME);
        await extApi.alarms.clear(BREAK_ALARM_NAME);
        const state = await storageService.getFocusState();
        const settings = await storageService.getSettings();

        const intervalSecs = (settings && settings.focusInterval ? settings.focusInterval : 60) * 60;
        const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
        const targetDurationMins = (settings && settings.focusDuration ? settings.focusDuration : 120);

        const now = Date.now();
        let remaining = state.remainingSeconds;
        if (state.targetTimestamp) {
          remaining = Math.max(0, Math.round((state.targetTimestamp - now) / 1000));
        }

        let breakRemaining = state.breakRemainingSeconds || breakSecs;
        if (state.breakIsRunning && state.breakTargetTimestamp) {
          breakRemaining = Math.max(0, Math.round((state.breakTargetTimestamp - now) / 1000));
        }

        let continuous = state.continuousFocusSeconds || 0;
        if (state.sessionStartTime) {
          const streak = Math.max(0, Math.round((now - state.sessionStartTime) / 1000));
          continuous = (state.lastContinuousBase || 0) + streak;
        }

        const breakUnlocked = (continuous >= intervalSecs) || Boolean(state.breakUnlocked);

        // Sync today's accumulated focus time
        const totalSecsToday = Math.max(0, (targetDurationMins * 60) - remaining);
        await storageService.syncTodayFocusSeconds(totalSecsToday, state.currentTask);

        if (state.sessionStartTime && (now - state.sessionStartTime >= 10000)) {
          const sessionMins = Math.max(1, Math.round((now - state.sessionStartTime) / 60000));
          await storageService.recordCompletedSession({
            start: new Date(state.sessionStartTime).toISOString(),
            end: new Date(now).toISOString(),
            duration: sessionMins,
            task: state.currentTask || "Focus Session"
          });
        }

        const newState = await storageService.saveFocusState({
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
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "RESUME_TIMER": {
        const state = await storageService.getFocusState();
        const settings = await storageService.getSettings();
        const defaultDuration = (settings && settings.focusDuration ? settings.focusDuration : 120);
        const remaining = (typeof state.remainingSeconds === "number" && state.remainingSeconds > 0)
          ? state.remainingSeconds
          : defaultDuration * 60;
        const targetTimestamp = Date.now() + remaining * 1000;

        await extApi.alarms.clear(ALARM_NAME);
        await extApi.alarms.create(ALARM_NAME, { when: targetTimestamp });

        const newState = await storageService.saveFocusState({
          isRunning: true,
          targetTimestamp: targetTimestamp,
          sessionStartTime: Date.now()
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "START_BREAK": {
        const state = await storageService.getFocusState();
        const settings = await storageService.getSettings();
        const breakDuration = (settings && settings.breakDuration) ? settings.breakDuration : 5;
        // Prefer the page's target: it already includes the 5s
        // start-of-break chime, so the alarm must not fire early.
        const breakTargetTimestamp = (typeof message.breakTargetTimestamp === "number" && message.breakTargetTimestamp > Date.now())
          ? message.breakTargetTimestamp
          : Date.now() + breakDuration * 60 * 1000;

        await extApi.alarms.clear(BREAK_ALARM_NAME);
        await extApi.alarms.create(BREAK_ALARM_NAME, { when: breakTargetTimestamp });

        // Ensure focus timer continues running in background!
        let focusTarget = state.targetTimestamp;
        let isFocusRunning = state.isRunning;
        let sessionStart = state.sessionStartTime;

        if (!isFocusRunning) {
          const defaultDuration = (settings && settings.focusDuration ? settings.focusDuration : 120);
          const remaining = (typeof state.remainingSeconds === "number" && state.remainingSeconds > 0)
            ? state.remainingSeconds
            : defaultDuration * 60;
          focusTarget = Date.now() + remaining * 1000;
          isFocusRunning = true;
          sessionStart = Date.now();
          await extApi.alarms.create(ALARM_NAME, { when: focusTarget });
        }

        const newState = await storageService.saveFocusState({
          currentTab: "break",
          breakUnlocked: true,
          breakIsRunning: true,
          breakRemainingSeconds: breakDuration * 60,
          breakTargetTimestamp: breakTargetTimestamp,
          breakAnnounceUntil: (typeof message.breakAnnounceUntil === "number") ? message.breakAnnounceUntil : null,
          breakEndChimePlayed: false,
          isRunning: isFocusRunning,
          targetTimestamp: focusTarget,
          sessionStartTime: sessionStart
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "FINISH_BREAK": {
        await extApi.alarms.clear(BREAK_ALARM_NAME);
        const settings = await storageService.getSettings();
        const breakSecs = (settings && settings.breakDuration ? settings.breakDuration : 5) * 60;
        const newState = await storageService.saveFocusState({
          currentTab: "focus",
          breakIsRunning: false,
          breakRemainingSeconds: breakSecs,
          breakUnlocked: false,
          continuousFocusSeconds: 0,
          lastContinuousBase: 0
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "SWITCH_TAB": {
        const tab = message.tab || "focus";
        const state = await storageService.getFocusState();
        if (tab === "break" && !state.breakUnlocked && !state.breakIsRunning) {
          sendResponse({ success: false, reason: "locked" });
          break;
        }
        const newState = await storageService.saveFocusState({
          currentTab: tab
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      case "SYNC_FOCUS_TIME": {
        const state = await storageService.getFocusState();
        const totalSecs = Number(message.totalSeconds || 0);
        await storageService.syncTodayFocusSeconds(totalSecs, state.currentTask);
        sendResponse({ success: true });
        break;
      }

      case "RESET_TIMER": {
        await extApi.alarms.clear(ALARM_NAME);
        await extApi.alarms.clear(BREAK_ALARM_NAME);
        const state = await storageService.getFocusState();
        const settings = await storageService.getSettings();
        const targetDurationMins = (settings && settings.focusDuration ? settings.focusDuration : 120);

        const now = Date.now();
        let remaining = state.remainingSeconds;
        if (state.targetTimestamp) {
          remaining = Math.max(0, Math.round((state.targetTimestamp - now) / 1000));
        }
        const totalSecsToday = Math.max(0, (targetDurationMins * 60) - remaining);
        await storageService.syncTodayFocusSeconds(totalSecsToday, state.currentTask);

        const newState = await storageService.saveFocusState({
          isRunning: false,
          remainingSeconds: remaining,
          targetTimestamp: null,
          sessionStartTime: null
        });
        sendResponse({ success: true, state: newState });
        break;
      }

      default:
        sendResponse({ success: false, error: "Unknown action" });
    }
  })();
  return true; // Keep message channel open for async response
});
