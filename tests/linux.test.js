const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../linux.js"), "utf8");

function setup({ lock = true, argv = [], minimumVersion = "1.137.0", settingsError } = {}) {
  const app = new EventEmitter();
  app.userAgentFallback = "Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0 Norc/1.139.0 Electron/41.5.0";
  app.requestSingleInstanceLock = () => lock;
  app.quit = () => { app.quitCalled = true; };
  app.getAppPath = () => "/app";
  app.getVersion = () => "1.139.0";
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, handler) => {
    if (handlers.has(name)) throw new Error("Attempted to register a second handler");
    handlers.set(name, handler);
  };
  const net = { fetch: async () => ({ ok: true, json: async () => ({ minimumElectronVersion: { version: minimumVersion } }) }) };
  const windows = [];
  const autoUpdater = {};
  const settingsCalls = [];
  const settingsMessages = [];
  const electronUtil = {};
  const dialog = { showMessageBox: async options => { settingsMessages.push(options); } };
  let loaded = false;
  const context = {
    process: { platform: "linux", argv, env: {} }, console, AbortSignal, URL,
    require(name) {
      if (name === "electron") return { app, dialog, ipcMain, net, BrowserWindow: { getAllWindows: () => windows } };
      if (name === "electron-updater") return { autoUpdater };
      if (name === "electron-util") return electronUtil;
      if (name === "./system-settings.js") return { openSystemSettings: async pane => {
        settingsCalls.push(pane);
        if (settingsError) throw settingsError;
      } };
      if (name === "node:path") return path;
      if (name === "compare-versions") return require("compare-versions");
      if (name === "./upstream.json") return { version: "1.139.0", electronVersion: "41.5.0" };
      if (name === "./main.js") { loaded = true; return {}; }
      throw new Error(name);
    },
  };
  vm.runInNewContext(source, context);
  function createWindow(url = "https://calendar.notion.so") {
    const webContents = new EventEmitter();
    const sent = [];
    webContents.send = (channel, data) => sent.push({ channel, ...data });
    webContents.getURL = () => url;
    const window = {
      webContents, sent, isDestroyed: () => false, isMinimized: () => true,
      restore() { this.restored = true; }, show() { this.shown = true; },
      focus() { this.focused = true; }, setIcon(icon) { this.icon = icon; },
    };
    windows.push(window);
    app.emit("browser-window-created", {}, window);
    return window;
  }
  return { app, ipcMain, autoUpdater, electronUtil, settingsCalls, settingsMessages, loaded, createWindow, context, handlers };
}

test("the upstream System Settings helper opens the Linux notification settings", async () => {
  const state = setup();
  await state.electronUtil.openSystemPreferences("notifications");
  assert.deepEqual(state.settingsCalls, ["notifications"]);
  assert.equal(state.settingsMessages.length, 0);
});

test("unavailable system settings show guidance instead of failing silently", async () => {
  const state = setup({ settingsError: new Error("No settings app") });
  await state.electronUtil.openSystemPreferences("notifications");
  assert.equal(state.settingsMessages.length, 1);
  assert.match(state.settingsMessages[0].detail, /Settings application and select Notifications/);
});

test("authentication callbacks are delivered without a calendar readiness event", () => {
  const state = setup({ argv: ["cron://www.notion.so/auth?code=test"] });
  const window = state.createWindow("https://www.notion.so/login/calendar");
  window.webContents.emit("dom-ready");
  assert.equal(window.sent[0].url, "cron://www.notion.so/auth?code=test");
});

test("DOM readiness on an unrelated page does not release OAuth callbacks", () => {
  const state = setup({ argv: ["cron://www.notion.so/auth?code=test"] });
  const window = state.createWindow("https://accounts.google.com");
  window.webContents.emit("dom-ready");
  assert.equal(window.sent.length, 0);
});

test("login version checks respect Notion's live minimum version", async () => {
  for (const [minimumVersion, blocked] of [["1.137.0", false], ["1.140.0", true]]) {
    const state = setup({ minimumVersion });
    state.app.emit("ready");
    assert.equal(await state.handlers.get("cronIsLoginBlockedByUnsupportedVersion")(), blocked);
  }
});

test("a version-check handler supplied by upstream is preserved", async () => {
  const state = setup();
  state.ipcMain.handle("cronIsLoginBlockedByUnsupportedVersion", async () => true);
  state.app.emit("ready");
  assert.equal(await state.handlers.get("cronIsLoginBlockedByUnsupportedVersion")(), true);
});

test("cold-start OAuth callbacks wait for the main renderer", () => {
  const state = setup({ argv: ["notion-calendar", "cron://oauth/callback?code=test", "https://example.com"] });
  const window = state.createWindow();
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: {} });
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  assert.deepEqual(window.sent, [{ channel: "cronHandleDeepLink", url: "cron://oauth/callback?code=test" }]);
});

test("warm-start callbacks restore and focus the existing instance", () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  state.app.emit("second-instance", {}, ["notion-calendar", "cron://oauth/callback?code=warm"]);
  assert.equal(window.sent[0].url, "cron://oauth/callback?code=warm");
  assert.ok(window.restored && window.shown && window.focused);
});

test("callbacks during a reload wait until the renderer is ready again", () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  window.webContents.emit("did-start-navigation", {}, "https://calendar.notion.so", false, true);
  state.app.emit("second-instance", {}, ["cron://oauth/reload"]);
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  assert.equal(window.sent[0].url, "cron://oauth/reload");
});

test("same-document navigation keeps authentication callbacks ready", () => {
  const state = setup();
  const window = state.createWindow("https://www.notion.so/login/calendar");
  window.webContents.emit("dom-ready");
  window.webContents.emit("did-start-navigation", {}, "https://www.notion.so/login/calendar?state=test", true, true);
  state.app.emit("second-instance", {}, ["cron://www.notion.so/auth?code=after-history-update"]);
  assert.equal(window.sent[0].url, "cron://www.notion.so/auth?code=after-history-update");
});

test("secondary process quits without loading the upstream app", () => {
  const state = setup({ lock: false });
  assert.ok(state.app.quitCalled);
  assert.equal(state.loaded, false);
});

test("Linux disables the upstream updater and preserves the Electron identity", async () => {
  const state = setup();
  assert.equal(await state.autoUpdater.checkForUpdates(), null);
  assert.equal(state.autoUpdater.autoDownload, false);
  assert.equal(state.autoUpdater.autoInstallOnAppQuit, false);
  assert.match(state.app.userAgentFallback, /Windows NT/);
  assert.match(state.app.userAgentFallback, /NotionCalendar\/1.139.0 Electron\/41.5.0/);
  assert.equal(state.app.getVersion(), "1.139.0");
  assert.equal(state.app.getLoginItemSettings().openAtLogin, false);
  assert.equal(state.context.process.env.WEB_URL, "https://calendar.notion.so");
});
