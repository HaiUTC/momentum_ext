const assert = require('assert');

console.log("=== Testing Firefox Promise vs Callback sendExtMessage Handling ===");

// Implementation under test
async function sendExtMessageTest(msg, env) {
  try {
    // 1. Firefox native browser.* API returns a Promise directly
    if (env.browser && env.browser.runtime && typeof env.browser.runtime.sendMessage === "function") {
      const msgPromise = env.browser.runtime.sendMessage(msg);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 50));
      return await Promise.race([msgPromise, timeoutPromise]);
    }

    // 2. Chromium chrome.* API uses callbacks or Promise with timeout
    if (env.chrome && env.chrome.runtime && typeof env.chrome.runtime.sendMessage === "function") {
      return await new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        }, 50);

        try {
          env.chrome.runtime.sendMessage(msg, (res) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(res || null);
            }
          });
        } catch (e) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(null);
          }
        }
      });
    }
  } catch (err) {
    console.warn("sendExtMessage error:", err);
  }
  return null;
}

(async () => {
  // Scenario 1: Firefox browser.* returns a Promise, ignores any callback
  const firefoxEnv = {
    browser: {
      runtime: {
        sendMessage: (msg, callback) => {
          // If callback was passed, Firefox native ignores it
          return Promise.resolve({ success: true, fromFirefox: true });
        }
      }
    }
  };

  const res1 = await sendExtMessageTest({ type: "START_FOCUS" }, firefoxEnv);
  assert.deepStrictEqual(res1, { success: true, fromFirefox: true }, "Must resolve Firefox Promise directly");
  console.log("✓ Scenario 1: Firefox Promise successfully resolved without callback");

  // Scenario 2: Background script never resolves in Firefox (hangs) -> Safety timeout kicks in
  const hangingEnv = {
    browser: {
      runtime: {
        sendMessage: () => new Promise(() => {}) // Never resolves
      }
    }
  };

  const startTime = Date.now();
  const res2 = await sendExtMessageTest({ type: "HANGING_MSG" }, hangingEnv);
  const elapsed = Date.now() - startTime;
  assert.strictEqual(res2, null, "Must resolve with null upon timeout");
  assert.ok(elapsed >= 45 && elapsed < 300, `Must timeout around 50ms, elapsed: ${elapsed}ms`);
  console.log(`✓ Scenario 2: Hanging background promise successfully timed out after ${elapsed}ms without freezing`);

  // Scenario 3: Chrome environment with callback
  const chromeEnv = {
    chrome: {
      runtime: {
        sendMessage: (msg, callback) => {
          setTimeout(() => callback({ success: true, fromChrome: true }), 10);
        }
      }
    }
  };

  const res3 = await sendExtMessageTest({ type: "START_FOCUS" }, chromeEnv);
  assert.deepStrictEqual(res3, { success: true, fromChrome: true }, "Must resolve Chrome callback");
  console.log("✓ Scenario 3: Chrome callback successfully resolved");

  console.log("=== ALL sendExtMessage TESTS PASSED 100% ===");
})();
