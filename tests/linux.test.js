const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { calendarFileArguments } = require("../calendar-files.js");
const source = fs.readFileSync(path.join(__dirname, "../linux.js"), "utf8");

function setup({
  lock = true,
  argv = [],
  minimumVersion = "1.137.0",
  settingsError,
  autostartError,
  platform = "linux",
  openExternal = async () => {},
  workingDirectory = "/launch",
  readCalendarFile = async (filename) => ({
    path: filename,
    contents: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  }),
} = {}) {
  const app = new EventEmitter();
  app.userAgentFallback =
    "Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0 Norc/1.139.0 Electron/41.5.0";
  app.requestSingleInstanceLock = () => lock;
  app.quit = () => {
    app.quitCalled = true;
  };
  app.getAppPath = () => "/app";
  app.getVersion = () => "1.139.0";
  app.isPackaged = true;
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, handler) => {
    if (handlers.has(name)) throw new Error("Attempted to register a second handler");
    handlers.set(name, handler);
  };
  const net = {
    fetch: async () => ({
      ok: true,
      json: async () => ({ minimumElectronVersion: { version: minimumVersion } }),
    }),
  };
  const windows = [];
  const autoUpdater = {};
  const settingsCalls = [];
  const settingsMessages = [];
  const electronUtil = {};
  const autostartCalls = [];
  const fileReads = [];
  const autostart = {
    getLoginItemSettings: () => ({
      openAtLogin: autostartCalls.at(-1)?.openAtLogin ?? false,
      openAsHidden: false,
      wasOpenedAtLogin: argv.includes("--from-login"),
    }),
    setLoginItemSettings: (options) => {
      if (autostartError) throw autostartError;
      autostartCalls.push(options);
    },
  };
  const dialog = {
    showMessageBox: async (options) => {
      settingsMessages.push(options);
    },
  };
  const externalCalls = [];
  const shell = {
    openExternal(url, options) {
      externalCalls.push({ url, options });
      return openExternal.call(this, url, options);
    },
  };
  let loaded = false;
  const context = {
    process: {
      platform,
      argv,
      env: {},
      execPath: "/opt/Norc/norc-bin",
      cwd: () => workingDirectory,
    },
    console,
    AbortSignal,
    URL,
    require(name) {
      if (name === "electron")
        return {
          app,
          dialog,
          ipcMain,
          net,
          shell,
          BrowserWindow: { getAllWindows: () => windows },
        };
      if (name === "electron-updater") return { autoUpdater };
      if (name === "electron-util") return electronUtil;
      if (name === "./update-links.js") return require("../update-links.js");
      if (name === "./calendar-files.js")
        return {
          calendarFileArguments,
          readCalendarFile: async (filename) => {
            fileReads.push(filename);
            return readCalendarFile(filename);
          },
        };
      if (name === "./autostart.js")
        return {
          createAutostart: ({ command }) => {
            assert.deepEqual(Array.from(command), ["/opt/Norc/norc"]);
            return autostart;
          },
        };
      if (name === "./system-settings.js")
        return {
          openSystemSettings: async (pane) => {
            settingsCalls.push(pane);
            if (settingsError) throw settingsError;
          },
        };
      if (name === "node:path") return path;
      if (name === "compare-versions") return require("compare-versions");
      if (name === "./upstream.json") return { version: "1.139.0", electronVersion: "41.5.0" };
      if (name === "./main.js") {
        loaded = true;
        return {};
      }
      throw new Error(name);
    },
  };
  vm.runInNewContext(source, context);
  function createWindow(url = "https://calendar.notion.so") {
    const webContents = new EventEmitter();
    const sent = [];
    webContents.send = (channel, data) => {
      const message = { channel, ...data };
      sent.push(message);
      webContents.emit("message-sent", message);
    };
    webContents.getURL = () => url;
    const window = {
      webContents,
      sent,
      destroyed: false,
      isDestroyed() {
        return this.destroyed;
      },
      isMinimized: () => true,
      restore() {
        this.restored = true;
      },
      show() {
        this.shown = true;
      },
      focus() {
        this.focused = true;
      },
      setIcon(icon) {
        this.icon = icon;
      },
    };
    windows.push(window);
    app.emit("browser-window-created", {}, window);
    return window;
  }
  return {
    app,
    ipcMain,
    autoUpdater,
    electronUtil,
    shell,
    externalCalls,
    settingsCalls,
    settingsMessages,
    autostartCalls,
    fileReads,
    loaded,
    createWindow,
    context,
    handlers,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Linux opens manual updates in Norc releases and preserves the external opener's contract", async () => {
  const result = Promise.resolve("opened");
  let receiver;
  const state = setup({
    openExternal() {
      receiver = this;
      return result;
    },
  });
  const options = { activate: true };
  assert.equal(
    state.shell.openExternal("https://www.notion.com/product/calendar/download/desktop", options),
    result,
  );
  assert.equal(await result, "opened");
  assert.equal(receiver, state.shell);
  assert.deepEqual(state.externalCalls, [
    { url: "https://github.com/rohankmr414/norc/releases/latest", options },
  ]);
  await state.shell.openExternal("https://meet.google.com/abc-defg-hij", options);
  assert.equal(state.externalCalls[1].url, "https://meet.google.com/abc-defg-hij");
});

test("external opening failures remain observable to the caller", async () => {
  const error = new Error("No default browser");
  const state = setup({
    openExternal: async () => {
      throw error;
    },
  });
  await assert.rejects(
    state.shell.openExternal("https://www.notion.com/product/calendar/download/desktop"),
    error,
  );
});

test("macOS and Windows keep their upstream download links", async () => {
  for (const platform of ["darwin", "win32"]) {
    const state = setup({ platform });
    const url = "https://www.notion.com/product/calendar/download/desktop";
    await state.shell.openExternal(url);
    assert.equal(state.externalCalls[0].url, url);
    assert.equal(state.loaded, true);
  }
});

test("a real local calendar file reaches the bridge's importer with its unchanged contents", async (t) => {
  const fsp = require("node:fs/promises");
  const { pathToFileURL } = require("node:url");
  const directory = await fsp.mkdtemp(path.join(require("node:os").tmpdir(), "norc-import-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "Meeting ✓.VCS");
  const contents = "BEGIN:VCALENDAR\r\nVERSION:1.0\r\nEND:VCALENDAR\r\n";
  await fsp.writeFile(filename, contents);
  const state = setup({
    argv: ["norc", pathToFileURL(filename).href],
    readCalendarFile: require("../calendar-files.js").readCalendarFile,
  });
  const window = state.createWindow();
  const delivery = once(window.webContents, "message-sent");
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  const [message] = await delivery;
  assert.deepEqual(message, {
    channel: "cronNativeFileOpen",
    path: path.join(directory, "Meeting ✓.vcs"),
    contents,
  });
});

test("calendar files launched at startup wait through sign-in for the calendar importer", async () => {
  const state = setup({
    argv: ["norc", "event.ics", "file:///launch/other.vcs", "cron://oauth/test"],
  });
  const window = state.createWindow("https://www.notion.so/login/calendar");
  window.webContents.emit("dom-ready");
  await flush();
  assert.deepEqual(state.fileReads, []);
  assert.deepEqual(window.sent, [{ channel: "cronHandleDeepLink", url: "cron://oauth/test" }]);
  state.ipcMain.emit("cronReady", { sender: {} });
  await flush();
  assert.deepEqual(state.fileReads, []);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  await flush();
  assert.deepEqual(state.fileReads, ["/launch/event.ics", "/launch/other.vcs"]);
  assert.deepEqual(
    window.sent
      .filter((message) => message.channel === "cronNativeFileOpen")
      .map((message) => message.path),
    state.fileReads,
  );
  assert.ok(window.restored && window.shown && window.focused);
});

test("a running instance resolves relative calendar paths from the second launch's directory", async () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  state.app.emit(
    "second-instance",
    {},
    ["norc", "meetings/event.ics", "file:///another/calendar.vcs"],
    "/second",
  );
  await flush();
  assert.deepEqual(state.fileReads, ["/second/meetings/event.ics", "/another/calendar.vcs"]);
  assert.equal(window.sent.length, 2);
  assert.ok(window.focused);
});

test("calendar requests during reload retain their order and are delivered only once", async () => {
  const state = setup({ argv: ["norc", "/first.ics"] });
  const window = state.createWindow();
  window.webContents.emit("did-start-navigation", {}, "https://calendar.notion.so", false, true);
  state.app.emit("second-instance", {}, ["norc", "later.vcs"], "/second");
  await flush();
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  await flush();
  assert.deepEqual(
    window.sent.map((message) => message.path),
    ["/first.ics", "/second/later.vcs"],
  );
});

test("a reload during a calendar read keeps the file queued until the importer is ready again", async () => {
  let release;
  const state = setup({
    argv: ["/event.ics"],
    readCalendarFile: (filename) =>
      new Promise((resolve) => {
        release = () => resolve({ path: filename, contents: "calendar contents" });
      }),
  });
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  window.webContents.emit("did-start-navigation", {}, "https://calendar.notion.so", false, true);
  release();
  await flush();
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  release();
  await flush();
  assert.deepEqual(window.sent, [
    { channel: "cronNativeFileOpen", path: "/event.ics", contents: "calendar contents" },
  ]);
});

test("a replacement calendar window receives pending files after the old window closes", async () => {
  let release;
  const state = setup({
    argv: ["/event.ics"],
    readCalendarFile: (filename) =>
      new Promise((resolve) => {
        release = () => resolve({ path: filename, contents: "calendar contents" });
      }),
  });
  const oldWindow = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: oldWindow.webContents });
  oldWindow.destroyed = true;
  const window = state.createWindow();
  release();
  await flush();
  assert.equal(oldWindow.sent.length, 0);
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  release();
  await flush();
  assert.equal(window.sent[0].path, "/event.ics");
});

test("failed calendar reads show guidance and do not discard later valid files", async () => {
  const state = setup({
    argv: ["/missing.ics", "/valid.vcs"],
    readCalendarFile: async (filename) => {
      if (filename === "/missing.ics") throw new Error("ENOENT");
      return { path: filename, contents: "valid calendar" };
    },
  });
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  await flush();
  assert.equal(state.settingsMessages[0].title, "Open calendar file");
  assert.match(state.settingsMessages[0].detail, /missing\.ics/);
  assert.deepEqual(window.sent, [
    { channel: "cronNativeFileOpen", path: "/valid.vcs", contents: "valid calendar" },
  ]);
});

test("an explicit calendar open takes precedence over hidden autostart", async () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  state.app.emit(
    "second-instance",
    {},
    ["norc", "--from-login", "--norc-start-hidden", "event.ics"],
    "/second",
  );
  await flush();
  assert.equal(window.sent[0].path, "/second/event.ics");
  assert.ok(window.focused);
});

test("same-document and subframe navigation preserve the calendar importer", async () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  window.webContents.emit(
    "did-start-navigation",
    {},
    "https://calendar.notion.so?date=test",
    true,
    true,
  );
  window.webContents.emit("did-start-navigation", {}, "https://example.com", false, false);
  state.app.emit("second-instance", {}, ["norc", "/event.ics"]);
  await flush();
  assert.equal(window.sent[0].path, "/event.ics");
});

test("the Linux login-item APIs delegate to XDG autostart", () => {
  const state = setup({ argv: ["norc", "--from-login"] });
  state.app.setLoginItemSettings({ openAtLogin: true });
  assert.equal(state.app.getLoginItemSettings().openAtLogin, true);
  assert.equal(state.app.getLoginItemSettings().wasOpenedAtLogin, true);
  assert.deepEqual(state.autostartCalls, [{ openAtLogin: true }]);
});

test("failed autostart writes show an error and do not report success to upstream", () => {
  const state = setup({ autostartError: new Error("Permission denied") });
  assert.throws(() => state.app.setLoginItemSettings({ openAtLogin: true }), /Permission denied/);
  assert.equal(state.app.getLoginItemSettings().openAtLogin, false);
  assert.equal(state.settingsMessages[0].title, "Start at login");
});

test("background autostart does not focus an already running instance, but OAuth still does", () => {
  const state = setup();
  const window = state.createWindow();
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  state.app.emit("second-instance", {}, ["norc", "--from-login", "--norc-start-hidden"]);
  assert.equal(window.shown, undefined);
  state.app.emit("second-instance", {}, [
    "norc",
    "--from-login",
    "--norc-start-hidden",
    "cron://oauth/test",
  ]);
  assert.equal(window.shown, true);
  assert.equal(window.sent[0].url, "cron://oauth/test");
});

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
  for (const [minimumVersion, blocked] of [
    ["1.137.0", false],
    ["1.140.0", true],
  ]) {
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
  const state = setup({
    argv: ["notion-calendar", "cron://oauth/callback?code=test", "https://example.com"],
  });
  const window = state.createWindow();
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: {} });
  assert.equal(window.sent.length, 0);
  state.ipcMain.emit("cronReady", { sender: window.webContents });
  assert.deepEqual(window.sent, [
    { channel: "cronHandleDeepLink", url: "cron://oauth/callback?code=test" },
  ]);
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
  window.webContents.emit(
    "did-start-navigation",
    {},
    "https://www.notion.so/login/calendar?state=test",
    true,
    true,
  );
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
