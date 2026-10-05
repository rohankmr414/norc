// Linux entry point for the upstream Notion Calendar desktop application.
const { app, BrowserWindow, ipcMain, net } = require("electron");
const path = require("node:path");

if (process.platform !== "linux") {
  require("./main.js");
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const upstream = require("./upstream.json");
  // In development the upstream app defaults to localhost.
  process.env.WEB_URL = "https://calendar.notion.so";
  // Keep the real Chromium version and Electron bridge while using the
  // supported Windows UI to avoid the Linux download-page redirect.
  app.userAgentFallback = app.userAgentFallback
    .replace(`Norc/${upstream.version}`, `NotionCalendar/${upstream.version}`)
    .replace(`norc/${upstream.version}`, `NotionCalendar/${upstream.version}`)
    .replace(
      /\([^)]*Linux[^)]*\)/,
      "(Windows NT 10.0; Win64; x64)",
    );
  // Electron's login-item APIs are implemented only on macOS and Windows.
  app.getLoginItemSettings = () => ({
    openAtLogin: false, openAsHidden: false, wasOpenedAtLogin: false,
  });
  app.setLoginItemSettings = () => {
    console.info("Configure Norc autostart in your desktop's startup settings.");
  };
  // The official update feed contains macOS/Windows binaries, not this build.
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.checkForUpdates = async () => null;
  autoUpdater.downloadUpdate = async () => [];
  autoUpdater.quitAndInstall = () => {};

  let mainWindow;
  let rendererReady = false;
  const pendingLinks = [];
  function deliverLinks() {
    if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
    while (pendingLinks.length) {
      mainWindow.webContents.send("cronHandleDeepLink", { url: pendingLinks.shift() });
    }
  }
  function handleArguments(argv) {
    pendingLinks.push(...argv.filter((argument) => /^cron:\/\//i.test(argument)));
    const window = mainWindow || BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    deliverLinks();
  }
  app.on("browser-window-created", (_event, window) => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = window;
    rendererReady = false;
    window.setIcon(path.join(app.getAppPath(), "build/icons/512x512.png"));
    window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      // History updates keep the preload and its IPC listeners alive.
      if (isMainFrame && !isInPlace) rendererReady = false;
    });
    // Notion's authentication preload installs its deep-link listener before
    // DOM ready, but the sign-in page does not send the calendar's cronReady.
    window.webContents.on("dom-ready", () => {
      const hostname = new URL(window.webContents.getURL()).hostname;
      if (["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"].includes(hostname)) {
        rendererReady = true;
        deliverLinks();
      }
    });
  });
  ipcMain.on("cronReady", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      rendererReady = true;
      deliverLinks();
    }
  });
  app.on("second-instance", (_event, argv) => handleArguments(argv));
  handleArguments(process.argv);
  require("./main.js");

  // The current Notion login page invokes this IPC even though the downloaded
  // desktop bundle doesn't register it. Respect the live minimum app version.
  app.once("ready", () => {
    try {
      ipcMain.handle("cronIsLoginBlockedByUnsupportedVersion", async () => {
        try {
          const response = await net.fetch("https://calendar.notion.so/config.json", {
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) return false;
          const minimum = (await response.json()).minimumElectronVersion?.version;
          return minimum ? require("compare-versions").compare(minimum, app.getVersion(), ">") : false;
        } catch {
          return false;
        }
      });
    } catch (error) {
      // A future upstream bundle may supply this handler itself.
      if (!error.message.includes("second handler")) throw error;
    }
  });
}
