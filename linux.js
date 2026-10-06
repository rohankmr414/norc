// Linux entry point for the upstream Notion Calendar desktop application.
const { app, BrowserWindow, dialog, ipcMain, net, shell } = require("electron");
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
    .replace(/\([^)]*Linux[^)]*\)/, "(Windows NT 10.0; Win64; x64)");
  // XDG autostart works across Linux desktops. Use the packaged wrapper so
  // startup retains its XWayland default and command-line handling.
  const { createAutostart } = require("./autostart.js");
  const command = app.isPackaged
    ? [path.join(path.dirname(process.execPath), "norc")]
    : [process.execPath, "--ozone-platform=x11", app.getAppPath()];
  const autostart = createAutostart({ command });
  app.getLoginItemSettings = autostart.getLoginItemSettings;
  app.setLoginItemSettings = (options) => {
    try {
      autostart.setLoginItemSettings(options);
    } catch (error) {
      dialog
        .showMessageBox({
          type: "error",
          title: "Start at login",
          message: "Could not update start at login",
          detail: "Check that your user configuration directory is writable, then try again.",
        })
        .catch((dialogError) =>
          console.warn("Unable to show autostart error:", dialogError.message),
        );
      // Upstream must not record a successful settings change after a failure.
      throw error;
    }
  };
  // The official update feed contains macOS/Windows binaries, not this build.
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.checkForUpdates = async () => null;
  autoUpdater.downloadUpdate = async () => [];
  autoUpdater.quitAndInstall = () => {};

  // Upstream's manual Download button opens the official desktop download
  // page. Route those links to Norc's releases through the shared opener,
  // covering IPC, navigation and new-window links before upstream loads.
  const { linuxUpdateUrl } = require("./update-links.js");
  const openExternal = shell.openExternal.bind(shell);
  shell.openExternal = (url, options) => openExternal(linuxUpdateUrl(url), options);

  // The upstream System Settings button calls this macOS/Windows-only helper.
  // Keep its IPC path and supply a desktop-aware Linux implementation.
  const { openSystemSettings } = require("./system-settings.js");
  require("electron-util").openSystemPreferences = async (pane) => {
    try {
      await openSystemSettings(pane);
    } catch (error) {
      console.warn("Unable to open system settings:", error.message);
      await dialog.showMessageBox({
        type: "error",
        title: "System settings",
        message: "Could not open system settings",
        detail:
          "Open your desktop's Settings application and select Notifications to manage Norc's notifications.",
      });
    }
  };

  let mainWindow;
  let rendererReady = false;
  let calendarReady = false;
  const pendingLinks = [];
  const pendingFiles = [];
  const { calendarFileArguments, readCalendarFile } = require("./calendar-files.js");
  let deliveringFiles = false;
  function focusWindow(window) {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  function deliverLinks() {
    if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
    while (pendingLinks.length) {
      mainWindow.webContents.send("cronHandleDeepLink", { url: pendingLinks.shift() });
    }
  }
  async function deliverFiles() {
    if (deliveringFiles) return;
    deliveringFiles = true;
    try {
      while (calendarReady && mainWindow && !mainWindow.isDestroyed() && pendingFiles.length) {
        const filename = pendingFiles[0];
        const window = mainWindow;
        let payload, error;
        try {
          payload = await readCalendarFile(filename);
        } catch (readError) {
          error = readError;
        }
        // A reload or replacement window must install its importer first.
        if (!calendarReady || mainWindow !== window || window.isDestroyed()) return;
        pendingFiles.shift();
        try {
          if (error) throw error;
          focusWindow(window);
          window.webContents.send("cronNativeFileOpen", payload);
        } catch (openError) {
          console.warn("Unable to open calendar file:", openError.message);
          dialog
            .showMessageBox({
              type: "error",
              title: "Open calendar file",
              message: "Could not open calendar file",
              detail: `Check that “${path.basename(filename)}” is a readable .ics or .vcs file, then try again.`,
            })
            .catch((dialogError) =>
              console.warn("Unable to show file-opening error:", dialogError.message),
            );
        }
      }
    } finally {
      deliveringFiles = false;
      if (calendarReady && mainWindow && !mainWindow.isDestroyed() && pendingFiles.length) {
        void deliverFiles();
      }
    }
  }
  function handleArguments(argv, workingDirectory) {
    const links = argv.filter((argument) => /^cron:\/\//i.test(argument));
    const files = calendarFileArguments(argv, workingDirectory);
    pendingLinks.push(...links);
    pendingFiles.push(...files);
    if (
      !links.length &&
      !files.length &&
      argv.includes("--from-login") &&
      argv.includes("--norc-start-hidden")
    )
      return;
    const window = mainWindow || BrowserWindow.getAllWindows()[0];
    focusWindow(window);
    deliverLinks();
    void deliverFiles();
  }
  app.on("browser-window-created", (_event, window) => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = window;
    rendererReady = false;
    calendarReady = false;
    window.setIcon(path.join(app.getAppPath(), "build/icons/512x512.png"));
    window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      // History updates keep the preload and its IPC listeners alive.
      if (isMainFrame && !isInPlace) {
        rendererReady = false;
        calendarReady = false;
      }
    });
    // Notion's authentication preload installs its deep-link listener before
    // DOM ready, but the sign-in page does not send the calendar's cronReady.
    window.webContents.on("dom-ready", () => {
      const hostname = new URL(window.webContents.getURL()).hostname;
      if (
        ["notion.so", "www.notion.so", "notion.com", "www.notion.com", "app.notion.com"].includes(
          hostname,
        )
      ) {
        rendererReady = true;
        deliverLinks();
      }
    });
  });
  ipcMain.on("cronReady", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      rendererReady = true;
      calendarReady = true;
      deliverLinks();
      void deliverFiles();
    }
  });
  app.on("second-instance", (_event, argv, workingDirectory) =>
    handleArguments(argv, workingDirectory || process.cwd()),
  );
  handleArguments(process.argv, process.cwd());
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
          return minimum
            ? require("compare-versions").compare(minimum, app.getVersion(), ">")
            : false;
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
