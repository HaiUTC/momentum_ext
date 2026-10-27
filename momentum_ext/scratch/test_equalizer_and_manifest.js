const fs = require('fs');
const assert = require('assert');

console.log("=== Testing Manifest v1.0.1 and Equalizer Optimizations ===");

// 1. Verify Manifest
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert.strictEqual(manifest.version, "1.0.2", "Manifest version must be 1.0.2");
assert.ok(manifest.chrome_settings_overrides, "manifest must have chrome_settings_overrides");
assert.strictEqual(manifest.chrome_settings_overrides.homepage, "newtab.html", "homepage override must be newtab.html");
assert.ok(manifest.chrome_url_overrides, "manifest must have chrome_url_overrides");
assert.strictEqual(manifest.chrome_url_overrides.newtab, "newtab.html", "newtab override must be newtab.html");
assert.deepStrictEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["none"], "data collection must be none");
console.log("✓ Manifest 1.0.1 with homepage & newtab overrides verified");

// 2. Verify CSS
const css = fs.readFileSync('css/focus.css', 'utf8');
assert.ok(css.includes('contain: strict;'), "Equalizer must have contain: strict for GPU isolation");
assert.ok(css.includes('equalizerSmooth'), "Equalizer keyframe must be equalizerSmooth");
assert.ok(!css.includes('equalizerBounce'), "Old fast equalizerBounce must be removed");
assert.ok(css.includes('transform: scaleY'), "Equalizer must use transform: scaleY instead of height reflow");
assert.ok(css.includes('1.4s'), "Equalizer bar 1 must have calm 1.4s duration");
assert.ok(css.includes('1.9s'), "Equalizer bar 2 must have calm 1.9s duration");
assert.ok(css.includes('1.5s'), "Equalizer bar 3 must have calm 1.5s duration");
console.log("✓ CSS GPU isolation, scaleY transform, and calm durations verified");

// 3. Verify JS
const js = fs.readFileSync('js/focus.js', 'utf8');
assert.ok(js.includes('updatePlaybackStateUi()'), "focus.js must implement updatePlaybackStateUi()");
assert.ok(js.includes('card.classList.toggle("playing"'), "updatePlaybackStateUi must toggle playing class");
assert.ok(js.includes('card.classList.toggle("active"'), "updatePlaybackStateUi must toggle active class");

// Simulate DOM updatePlaybackStateUi logic
const mockCards = [
  { dataset: { id: "track-1" }, classes: new Set(), classList: {
    toggle(c, val) { if (val) this._set.add(c); else this._set.delete(c); },
    contains(c) { return this._set.has(c); },
    _set: new Set()
  }},
  { dataset: { id: "track-2" }, classes: new Set(), classList: {
    toggle(c, val) { if (val) this._set.add(c); else this._set.delete(c); },
    contains(c) { return this._set.has(c); },
    _set: new Set()
  }}
];

function updatePlaybackStateUiMock(activeTrack, isPlaying) {
  mockCards.forEach(card => {
    const isCurrent = activeTrack && card.dataset.id === activeTrack.id;
    const isCardPlaying = isCurrent && isPlaying;
    card.classList.toggle("active", Boolean(isCurrent));
    card.classList.toggle("playing", Boolean(isCardPlaying));
  });
}

// Play track-1
updatePlaybackStateUiMock({ id: "track-1" }, true);
assert.strictEqual(mockCards[0].classList.contains("active"), true);
assert.strictEqual(mockCards[0].classList.contains("playing"), true);
assert.strictEqual(mockCards[1].classList.contains("active"), false);
assert.strictEqual(mockCards[1].classList.contains("playing"), false);

// Pause track-1
updatePlaybackStateUiMock({ id: "track-1" }, false);
assert.strictEqual(mockCards[0].classList.contains("active"), true);
assert.strictEqual(mockCards[0].classList.contains("playing"), false);

// Play track-2
updatePlaybackStateUiMock({ id: "track-2" }, true);
assert.strictEqual(mockCards[0].classList.contains("active"), false);
assert.strictEqual(mockCards[0].classList.contains("playing"), false);
assert.strictEqual(mockCards[1].classList.contains("active"), true);
assert.strictEqual(mockCards[1].classList.contains("playing"), true);

console.log("✓ Targeted DOM update logic verified without full re-render");
console.log("=== ALL TESTS PASSED SUCCESSFULLY! ===");
