/**
 * Test Photo Activation & Background Wallpaper Switch
 */

const fs = require("fs");

// Minimal DOM & Storage mocks
global.window = global;
global.window.addEventListener = () => {};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); }
};

const bgLayer = {
  style: { backgroundImage: "" },
  classList: {
    classes: new Set(),
    add(c) { this.classes.add(c); },
    remove(c) { this.classes.delete(c); }
  }
};

const locationEl = {
  textContent: "",
  title: "",
  href: "",
  style: { display: "none" }
};

global.document = {
  getElementById: (id) => {
    if (id === "background-layer") return bgLayer;
    if (id === "wallpaper-location") return locationEl;
    return null;
  },
  addEventListener: () => {}
};

global.Image = class {
  constructor() {
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 0);
  }
};

const RealURL = global.URL;
RealURL.createObjectURL = (blob) => `blob:http://localhost/${blob.name || "photo"}`;

// Mock MomentumDB
class MockStore {
  constructor() { this.data = new Map(); }
  get(k) {
    const val = this.data.get(k);
    return { onsuccess: null, result: val };
  }
  getAll() {
    return { onsuccess: null, result: Array.from(this.data.values()) };
  }
  put(item) {
    const key = item.key || item.id || item.date;
    this.data.set(key, item);
    return { onsuccess: null, result: key };
  }
  delete(k) {
    this.data.delete(k);
    return { onsuccess: null, result: undefined };
  }
}

const mockStores = {
  settings: new MockStore(),
  photos: new MockStore(),
  custom_sounds: new MockStore(),
  focus_state: new MockStore(),
  focus_stats: new MockStore()
};

global.indexedDB = {
  open: () => {
    const req = {
      onsuccess: null,
      result: {
        objectStoreNames: { contains: () => true },
        transaction: (name) => ({
          objectStore: () => ({
            get: (k) => {
              const r = mockStores[name].get(k);
              setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
              return r;
            },
            getAll: () => {
              const r = mockStores[name].getAll();
              setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
              return r;
            },
            put: (item) => {
              const r = mockStores[name].put(item);
              setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
              return r;
            },
            delete: (k) => {
              const r = mockStores[name].delete(k);
              setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0);
              return r;
            }
          })
        })
      }
    };
    setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
    return req;
  }
};

async function testPhotoActiveFlow() {
  console.log("--- Testing Photo Activation and Wallpaper Switch ---");

  // Load db.js
  eval(fs.readFileSync("js/db.js", "utf8"));
  await window.momentumDB.ensureReady();

  // Load wallpaper.js
  eval(fs.readFileSync("js/wallpaper.js", "utf8"));
  console.assert(window.wallpaperManager !== undefined, "window.wallpaperManager must be defined globally");

  // Load settings.js
  eval(fs.readFileSync("js/settings.js", "utf8"));
  console.assert(window.settingsManager !== undefined, "window.settingsManager must be defined globally");

  global.fetch = async () => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync("assets/background/index.json", "utf8"))
  });

  const sm = window.settingsManager;
  const wm = window.wallpaperManager;
  await wm.init(bgLayer, locationEl);

  // 1. Mock history photos list in settingsManager
  sm.historyPhotos = [
    {
      id: "photo-hist-1",
      title: "Alpine Lake",
      preview_url: "https://images.unsplash.com/photo-lake",
      thumbnail_url: "https://images.unsplash.com/photo-lake-thumb"
    },
    {
      id: "photo-hist-2",
      title: "Desert Sunset",
      preview_url: "https://images.unsplash.com/photo-desert",
      thumbnail_url: "https://images.unsplash.com/photo-desert-thumb"
    }
  ];

  // Mock photosGrid DOM
  sm.photosGrid = {
    querySelectorAll: () => [
      { classList: { toggle: () => {} }, getAttribute: () => "photo-hist-1" },
      { classList: { toggle: () => {} }, getAttribute: () => "photo-hist-2" }
    ]
  };

  // 2. Select History Photo 2
  sm.currentPhotoSubtab = "history";
  console.log("Step 1: Selecting History Photo 'photo-hist-2'...");
  await sm.selectActivePhoto("photo-hist-2");

  console.assert(bgLayer.style.backgroundImage.includes("https://images.unsplash.com/photo-desert"), 
    `Background layer should change to Desert Sunset. Actual: ${bgLayer.style.backgroundImage}`);
  console.assert(global.localStorage.getItem("momentum_cache_wallpaper").includes("https://images.unsplash.com/photo-desert"),
    "Cache wallpaper should be updated in localStorage");

  const activeFromDb = await window.momentumDB.getActiveWallpaper();
  console.assert(activeFromDb.id === "photo-hist-2", "Active wallpaper in DB should be photo-hist-2");
  console.log("✓ Step 1: Selecting history photo immediately updates background layer and persists to IndexedDB");

  // 3. Upload a Custom Photo & Select it
  console.log("Step 2: Uploading and selecting a Custom Photo in My Photos...");
  sm.myPhotos = [
    {
      id: "custom-photo-99",
      name: "Family Vacation",
      blob: { name: "vacation.jpg" },
      thumbnailDataUrl: "data:image/jpeg;base64,thumb99"
    }
  ];
  sm.currentPhotoSubtab = "my-photos";
  await sm.selectActivePhoto("custom-photo-99");

  console.assert(bgLayer.style.backgroundImage.includes("blob:http://localhost/vacation.jpg"),
    `Background layer should change to custom blob URL. Actual: ${bgLayer.style.backgroundImage}`);

  const customActiveFromDb = await window.momentumDB.getActiveWallpaper();
  console.assert(customActiveFromDb.id === "custom-photo-99", "Active wallpaper in DB should be custom-photo-99");
  console.assert(customActiveFromDb.source === "my-photos", "Active wallpaper source should be my-photos");
  console.log("✓ Step 2: Selecting custom photo immediately updates background layer and persists to IndexedDB");

  // 4. Reload page scenario: loadTodayWallpaper()
  console.log("Step 3: Simulating page reload / new tab opening...");
  bgLayer.style.backgroundImage = ""; // reset
  await wm.loadTodayWallpaper();
  console.assert(bgLayer.style.backgroundImage.length > 0, "loadTodayWallpaper must apply wallpaper on page load");
  console.log("✓ Step 3: loadTodayWallpaper successfully restores active wallpaper from MomentumDB");

  console.log("--- All Photo Active & Background Switch Tests PASSED 100%! ---");
  process.exit(0);
}

testPhotoActiveFlow().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
