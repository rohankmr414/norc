/*! For license information please see main.js.LICENSE.txt */
(() => {
  "use strict";
  var e = {
    n: (n) => {
      var o = n && n.__esModule ? () => n.default : () => n;
      return e.d(o, { a: o }), o;
    },
    d: (n, o) => {
      for (var t in o) e.o(o, t) && !e.o(n, t) && Object.defineProperty(n, t, { enumerable: !0, get: o[t] });
    },
    o: (e, n) => Object.prototype.hasOwnProperty.call(e, n),
  };
  const n = require("@sentry/electron"),
    o = require("@sentry/integrations"),
    t = require("@todesktop/runtime");
  var i = e.n(t);
  const a = require("axios");
  var r = e.n(a);
  const l = require("compare-versions"),
    s = require("electron");
  var c = e.n(s);
  const d = require("electron-context-menu");
  var u = e.n(d);
  const p = require("electron-store");
  var h = e.n(p);
  const v = require("electron-util");
  var f = e.n(v);
  const m = require("electron-window-state");
  var g = e.n(m);
  const w = require("fs");
  var b = e.n(w);
  const y = require("http-status-codes");
  var M = e.n(y);
  const C = require("lodash");
  var S = e.n(C);
  const k = require("path");
  var x = e.n(k);
  let I;
  function F(e) {
    return { type: e ? "separator" : "normal", label: e ? void 0 : "", visible: e };
  }
  !(function (e) {
    (e.enDash = "–"),
      (e.emDash = "—"),
      (e.middleDot = "·"),
      (e.noBreakSpace = " "),
      (e.hairSpace = " "),
      (e.thinSpace = " "),
      (e.enSpace = " "),
      (e.emSpace = " "),
      (e.minusSign = "−"),
      (e.rightSingleQuotationMark = "’"),
      (e.leftDoubleQuotationMark = "“"),
      (e.rightDoubleQuotationMark = "”"),
      (e.rightAngleQuotationMark = "›"),
      (e.horizontalEllipsis = "…"),
      (e.warningSign = "⚠");
  })(I || (I = {}));
  const T = !c().app.isPackaged,
    L = `${c().app.getVersion()}${T ? "-dev" : ""}`,
    A = T ? "https://calendar.cron.com" : "https://calendar.cron.com",
    R = T ? "https://api.cron.com" : "https://api.cron.com",
    U = "user.preferences.nativeTheme",
    D = "installation.firstSignedInVersion",
    W = "installation.lastNotificationPostedVersion",
    O = "installation.hasSetLoginItemSettings";
  if (T) {
    const e = `${c().app.getPath("userData")}-Dev`;
    c().app.setPath("userData", e);
  }
  try {
    i().init({ autoUpdater: !1 });
  } catch (e) {}
  let q;
  T ||
    n.init({
      dsn: "https://a71799ab77714d168adcb1c0ffac08fd@o356515.ingest.sentry.io/6138314",
      release: L,
      environment: T ? "production" : "production",
      integrations: [new o.RewriteFrames()],
    }),
    u()({ showCopyImageAddress: !0, showSaveImageAs: !0 });
  let z,
    B,
    P = c().app.requestSingleInstanceLock();
  "linux" !== process.platform || P || c().app.quit(),
    T && "linux" === process.platform && ((z = process.execPath), (B = [x().resolve(process.argv[1])])),
    c().app.setAsDefaultProtocolClient("cron", z, B),
    "linux" === process.platform && c().app.setAppUserModelId("com.cron.electron");
  const N = "linux" === process.platform ? c().app.dock : void 0,
    V = new (h())(),
    E = () => {
      const { width: e, height: n } = c().screen.getPrimaryDisplay().workArea;
      let o = e,
        t = n;
      if (e > 1280) {
        const i = Math.round(0.08 * n),
          a = Math.round(0.12 * e);
        (o = Math.min(1440, o - 2 * a)), (t = Math.min(900, t - 2 * i));
      }
      return { width: o, height: t };
    };
  function H() {
    !q && c().app.isReady() ? Y() : ee();
  }
  let $,
    G = !1,
    Q = !1,
    j = !1,
    _ = [];
  function Z() {
    var e;
    if (((G = !0), $ && clearTimeout($), c().app.getLoginItemSettings().wasOpenedAsHidden && !j)) (j = !0), re();
    else if (!((null !== (e = q) && void 0 !== e && e.isVisible()) || Q)) {
      var n;
      null === (n = q) || void 0 === n || n.show();
    }
    _.forEach((e) => e()), (_ = []), qe();
  }
  function J() {
    return c().nativeTheme.shouldUseDarkColors ? "#262626" : "#FFFFFF";
  }
  function K() {
    return A;
  }
  function X() {
    return { backgroundThrottling: !1, preload: x().join(c().app.getAppPath(), "build/preload/preload-bundle.js") };
  }
  function Y() {
    (G = !1),
      (function () {
        const e = V.get(U);
        "light" === e
          ? (c().nativeTheme.themeSource = "light")
          : "dark" === e
          ? (c().nativeTheme.themeSource = "dark")
          : "system" === e && (c().nativeTheme.themeSource = "system");
      })();
    const e = (() => {
      const e = E();
      return g()({ defaultWidth: e.width, defaultHeight: e.height, fullScreen: !1 });
    })();
    (q = new (c().BrowserWindow)({
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      minWidth: 500,
      minHeight: 376,
      backgroundColor: J(),
      title: "Cron",
      webPreferences: X(),
      titleBarStyle: "linux" === process.platform ? "customButtonsOnHover" : "hidden",
      trafficLightPosition: { x: 7, y: 6 },
      show: !1,
    })),
      e.manage(q),
      T || ($ = setTimeout(Z, 5e3)),
      q.webContents.on("new-window", (e, n, o, t, i, a, r) => {
        "_blank" === o && e.preventDefault();
      }),
      q.webContents.on("did-fail-load", () => {
        var e;
        const n = x().resolve(c().app.getAppPath(), "build/main/offline.html");
        null === (e = q) || void 0 === e || e.webContents.loadFile(n, { query: { appURL: K() } }), Z();
      }),
      q.webContents.on("render-process-gone", async (e, o) => {
        var t, i, a;
        "clean-exit" !== o.reason &&
          (n.captureMessage("Renderer process gone", {
            contexts: { details: { ...o }, diagnostics: { memory: process.memoryUsage() } },
          }),
          (Q = !(null !== (t = q) && void 0 !== t && t.isFocused())),
          null === (i = q) || void 0 === i || i.close(),
          null === (a = q) || void 0 === a || a.webContents.removeAllListeners(),
          ne(),
          Y());
      });
    const o = K();
    q.loadURL(o),
      console.log(`Loading ${o}...`),
      q.on("enter-full-screen", () => {
        var e, n;
        null === (e = q) ||
          void 0 === e ||
          e.webContents.send("cronFullscreenChange", null === (n = q) || void 0 === n ? void 0 : n.fullScreen);
      }),
      q.on("leave-full-screen", () => {
        var e, n, o;
        ie && ((ie = !1), null === (o = q) || void 0 === o || o.hide()),
          null === (e = q) ||
            void 0 === e ||
            e.webContents.send("cronFullscreenChange", null === (n = q) || void 0 === n ? void 0 : n.fullScreen);
      }),
      q.on("move", () => {
        var e;
        null === (e = q) || void 0 === e || e.webContents.send("cronWindowMove", q.getBounds());
      }),
      q.on("maximize", () => {
        var e;
        null === (e = q) || void 0 === e || e.webContents.send("cronWindowMaximize");
      }),
      q.on("unmaximize", () => {
        var e;
        null === (e = q) || void 0 === e || e.webContents.send("cronWindowUnmaximize");
      }),
      q.on("show", () => {
        var e;
        N && !N.isVisible() && (null === (e = q) || void 0 === e || e.hide());
      }),
      q.on("close", (e) => {
        var n, o, t;
        te ||
          (e.preventDefault(),
          null !== (n = q) && void 0 !== n && n.isFullScreen()
            ? ((ie = !0), null === (o = q) || void 0 === o || o.setFullScreen(!1))
            : null === (t = q) || void 0 === t || t.hide());
      }),
      q.on("closed", () => {
        ne();
      }),
      q.on("unresponsive", async () => {
        const { response: e } = await c().dialog.showMessageBox({
          type: "info",
          title: "Renderer Process Hanging",
          message: "This process is hanging",
          buttons: ["Reload", "Close", "Wait"],
        });
        var n;
        if (0 === e) null === (n = q) || void 0 === n || n.reload();
        else if (1 === e) {
          var o;
          null === (o = q) || void 0 === o || o.close(), ne();
        }
      });
  }
  function ee() {
    var e, n, o;
    if ((null === (e = q) || void 0 === e || e.show(), N && !N.isVisible()))
      c().app.show(),
        N.show(),
        null === (n = q) || void 0 === n || n.setVisibleOnAllWorkspaces(!1, { visibleOnFullScreen: !1 }),
        null === (o = q) || void 0 === o || o.webContents.send("cronAppRunningInBackgroundChange", !1);
    else if (ve) {
      var t;
      (ve = !1), null === (t = q) || void 0 === t || t.webContents.send("cronAppRunningInBackgroundChange", !1);
    }
  }
  function ne() {
    q = void 0;
  }
  function oe(e) {
    var n;
    null === (n = q) || void 0 === n || n.webContents.send("cronHandleDeepLink", { url: e });
  }
  c().app.on("open-file", (e, o) => {
    const t = x().extname(o);
    if (![".ics", ".vcs"].includes(t)) return;
    e.preventDefault(), ee();
    const i = () =>
      (function (e) {
        if (q)
          try {
            const n = b().readFileSync(e, "utf-8");
            q.webContents.send("cronNativeFileOpen", { path: e, contents: n });
          } catch (e) {
            console.error("Failed to open file:", e), n.captureException(e);
          }
      })(o);
    G ? i() : _.push(i);
  }),
    c().app.on("ready", () => {
      !(function () {
        const e = (function (e) {
          const { onMenuItemSelect: n } = e,
            o = "linux" === process.platform;
          return s.Menu.buildFromTemplate([
            {
              label: s.app.name,
              submenu: [
                { role: "about" },
                { id: "checkForUpdates", label: `Check for Updates${I.horizontalEllipsis}`, click: n },
                {
                  id: "goToSettings",
                  label: `Settings${I.horizontalEllipsis}`,
                  accelerator: "CommandOrControl+,",
                  click: n,
                },
                F(o),
                { role: "services", visible: o },
                F(o),
                { role: "hide", visible: o },
                { role: "hideOthers", visible: o },
                { role: "unhide", visible: o },
                F(o),
                { role: "quit", visible: o },
              ],
            },
            {
              role: "editMenu",
              submenu: [
                { role: "undo" },
                { role: "redo" },
                { type: "separator" },
                { role: "cut" },
                { role: "copy" },
                { role: "paste" },
                { role: "pasteAndMatchStyle" },
                { id: "delete", role: void 0, label: "Delete", accelerator: "Backspace", enabled: !1, click: n },
                { id: "selectAll", role: void 0, label: "Select All", accelerator: "CommandOrControl+A", click: n },
                { id: "duplicate", label: "Duplicate", accelerator: "CommandOrControl+D", enabled: !1, click: n },
                F(o),
                { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }], visible: o },
              ],
            },
            {
              role: "viewMenu",
              submenu: [
                {
                  id: "resetGridDensity",
                  label: "Default Hour Size",
                  accelerator: "Shift+CommandOrControl+num0",
                  click: n,
                },
                { id: "zoomGridDensityIn", label: "Zoom Hours In", accelerator: "Shift+CommandOrControl+.", click: n },
                {
                  id: "zoomGridDensityOut",
                  label: "Zoom Hours Out",
                  accelerator: "Shift+CommandOrControl+,",
                  click: n,
                },
                { type: "separator" },
                { label: "Interface Scale", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
                { id: "reload", role: void 0, label: "Reload", accelerator: "CommandOrControl+R", click: n },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "togglefullscreen" },
              ],
            },
            {
              role: "window",
              visible: o,
              submenu: [
                { role: "minimize" },
                { role: "close" },
                { role: "zoom" },
                { type: "separator" },
                { id: "showCronWindow", label: "Cron", accelerator: "CommandOrControl+1", click: n },
                { type: "separator" },
                { role: "front" },
              ],
            },
            { role: "help", submenu: [{ label: "Learn more", click: () => s.shell.openExternal("https://cron.com") }] },
          ]);
        })({
          onMenuItemSelect: (e) => {
            var n;
            const o = (function (e) {
              return S().omitBy(
                S().pick(e, [
                  "accelerator",
                  "checked",
                  "commandId",
                  "enabled",
                  "id",
                  "role",
                  "sublabel",
                  "toolTip",
                  "type",
                  "visible",
                ]),
                S().isNil
              );
            })(e);
            null === (n = q) || void 0 === n || n.webContents.send("cronMenuItemSelect", o);
          },
        });
        c().Menu.setApplicationMenu(e);
      })(),
        c().nativeTheme.on("updated", () => {
          var e;
          const n = J();
          null === (e = q) || void 0 === e || e.setBackgroundColor(n);
        }),
        T ||
          (ze(),
          process.on("uncaughtException", function (e) {
            console.log("[main]", e);
          })),
        Y(),
        c().ipcMain.on("cronReady", Z),
        c().ipcMain.on("cronQuit", () => {
          c().app.quit();
        }),
        c().ipcMain.handle("cronAppRunningInBackground", () =>
          "linux" === process.platform ? !!N && !N.isVisible() : ve
        ),
        c().ipcMain.handle("cronFullscreen", () => {
          var e;
          return null === (e = q) || void 0 === e ? void 0 : e.fullScreen;
        }),
        c().ipcMain.handle("cronWindowFocused", () => {
          var e;
          return null === (e = q) || void 0 === e ? void 0 : e.isFocused();
        }),
        c().ipcMain.handle("cronLastNotificationPostedVersion", () => V.get(W)),
        c().ipcMain.handle("cronPushNotification", (e, n) => {
          ye(n);
        }),
        c().ipcMain.on("cronShowNotification", (e, n) => {
          ye(n);
        }),
        c().ipcMain.on("cronCloseNotification", (e, n) => {
          !(function (e) {
            const n = we.get(e);
            n && n.close();
          })(n);
        }),
        c().ipcMain.on("cronCreateNotificationsWindow", (e, { url: n, width: o, height: t }) => {
          !(function (e, n, o) {
            const t = !!N && !N.isVisible();
            if (!Ce) {
              (Ce = new (c().BrowserWindow)({
                alwaysOnTop: !0,
                transparent: !0,
                frame: !1,
                hasShadow: !1,
                movable: !1,
                resizable: !1,
                fullscreen: !1,
                fullscreenable: !1,
                enableLargerThanScreen: !0,
                show: !1,
                focusable: De(),
                webPreferences: { ...X(), devTools: T },
              })),
                Ce.loadURL(e),
                Ce.setVisibleOnAllWorkspaces(!0, { skipTransformProcessType: !0 });
              const n = () => {
                const { width: e, height: n } = xe;
                Re(e, n);
              };
              c().screen.on("display-metrics-changed", n),
                Ce.on("hide", () => {
                  var e;
                  Ce &&
                    (Ce.isVisible() ||
                      (Ie &&
                        (null === (e = q) || void 0 === e || e.hide(), Le(), N && N.isVisible() && G && (Te = !0))));
                }),
                Ce.on("close", () => {
                  c().screen.removeListener("display-metrics-changed", n);
                }),
                Ce.on("closed", () => {
                  Ae();
                });
            }
            (xe = { width: n, height: o }), Re(n, o), t && N.hide();
          })(n, o, t);
        }),
        c().ipcMain.on("cronShowNotificationsWindow", () => {
          Le();
        }),
        c().ipcMain.on("cronHideNotificationsWindow", () => {
          Ce && ((Ie = !1), Ce.hide());
        }),
        c().ipcMain.on("cronDestroyNotificationsWindow", () => {
          Ce && (Ce.removeAllListeners(), Ce.webContents.removeAllListeners(), Ce.close(), Ae());
        }),
        c().ipcMain.on("cronResizeNotificationsWindow", (e, { width: n, height: o }) => {
          Re(n, o);
        }),
        c().ipcMain.on("cronSendGenericNotification", (e, n) => {
          const o = `${R}/v1/notify`;
          r()
            .post(o, n)
            .catch((e) => console.log(e.message));
        }),
        c().ipcMain.on("cronSendFeedback", (e, n) => {
          const o = `${R}/v1/feedback`;
          r()
            .post(o, n)
            .then((n) => {
              200 === n.status && "string" == typeof n.data && "ok" === n.data.toLowerCase()
                ? (console.log(n), e.reply("cronSendFeedbackSucceeded", n.statusText))
                : e.reply("cronSendFeedbackFailed", n.statusText);
            })
            .catch((n) => e.reply("cronSendFeedbackFailed", n.message));
        }),
        c().ipcMain.on("cronCrashMain", (e, n) => {
          console.log("Crashing main process..."), process.crash();
        }),
        c().ipcMain.on("cronCrashRenderer", (e, n) => {
          var o;
          console.log("Crashing renderer process...");
          const t = null === (o = q) || void 0 === o ? void 0 : o.webContents.getOSProcessId();
          t && process.kill(t, "SIGSEGV");
        }),
        c().ipcMain.on("cronOptimalWindowSize", (e, n) => {
          e.returnValue = E();
        }),
        c().ipcMain.on("cronResetOptimalWindowSize", () => {
          var e, n;
          const { width: o, height: t } = E();
          null === (e = q) || void 0 === e || e.setSize(o, t), null === (n = q) || void 0 === n || n.center();
        }),
        c().ipcMain.handle("cronWindowMaximized", () => {
          var e;
          return !(null === (e = q) || void 0 === e || !e.isMaximized());
        }),
        c().ipcMain.on("cronToggleWindowMaximized", () => {
          var e, n;
          null !== (e = q) && void 0 !== e && e.isMaximized()
            ? q.unmaximize()
            : null === (n = q) || void 0 === n || n.maximize();
        }),
        c().ipcMain.on("cronMinimizeWindow", () => {
          var e;
          null === (e = q) || void 0 === e || e.minimize();
        }),
        c().ipcMain.on("cronWebContentsZoomIn", (e, n) => {
          if (q) {
            const e = q.webContents.getZoomLevel();
            q.webContents.setZoomLevel(e + 0.5);
          }
        }),
        c().ipcMain.on("cronCurrentUserChange", (e, o) => {
          o.isLoggedIn && (V.get(D) || V.set(D, L), V.set("installation.lastSignedInVersion", L)),
            n.configureScope((e) => {
              const n = o.email ? { email: o.email } : null;
              e.setUser(n);
            });
        }),
        c().ipcMain.on("cronNativeThemeChange", (e, { theme: n }) => {
          (c().nativeTheme.themeSource = n), V.set(U, n);
        }),
        c().ipcMain.handle("cronGetLoginItemSettings", (e) => {
          const n = V.get(O, !1);
          return { ...c().app.getLoginItemSettings(), hasSetBefore: n };
        }),
        c().ipcMain.on("cronSetLoginItemSettings", (e, n) => {
          const { openAtLogin: o, openAsHidden: t } = n,
            i = c().app.getLoginItemSettings();
          (i.openAtLogin === o && i.openAsHidden === t) ||
            (c().app.setLoginItemSettings({ openAtLogin: o, openAsHidden: t }), V.set(O, !0));
        }),
        c().ipcMain.on("cronFlushStorageData", () => {
          var e;
          null === (e = q) || void 0 === e || e.webContents.session.flushStorageData();
        }),
        c().ipcMain.on("cronUpdateTray", (e, n) => {
          fe(n);
        }),
        c().ipcMain.on("cronDestroyTray", () => {
          ue && (ue.removeAllListeners(), ue.destroy(), (ue = void 0), (pe = void 0));
        }),
        c().ipcMain.on("cronUpdateDockMenu", (e, n) => {
          !(async function (e) {
            if (!N) return;
            const n = await me(e);
            N.setMenu(n);
          })(n);
        }),
        c().ipcMain.on("cronAddGlobalShortcut", (e, { accelerator: n } = {}) => {
          !(function (e) {
            ge(e),
              c().globalShortcut.register(e, () => {
                var n;
                null === (n = q) || void 0 === n || n.webContents.send("cronGlobalShortcut", { accelerator: e });
              });
          })(n);
        }),
        c().ipcMain.on("cronRemoveGlobalShortcut", (e, { accelerator: n } = {}) => {
          ge(n);
        }),
        c().ipcMain.on("cronSetRunInBackground", (e, { runInBackground: n } = {}) => {
          !(function (e) {
            he = e;
          })(n);
        }),
        c().ipcMain.on("cronQuitCompletely", () => {
          ae();
        }),
        c().ipcMain.on("cronOpenTrayContextMenu", (e) => {
          !(function () {
            if (ue)
              if ("linux" === process.platform) ue.popUpContextMenu();
              else {
                const e = ue.getBounds();
                ue.popUpContextMenu(pe, { x: e.x, y: e.y });
              }
          })();
        }),
        c().ipcMain.on("cronShowWindow", () => {
          ee();
        }),
        c().ipcMain.on("cronCloseWindow", () => {
          var e;
          null === (e = q) || void 0 === e || e.close(), le();
        }),
        c().ipcMain.on("cronPreloadImage", (e, { url: n } = {}) => {
          !(function (e) {
            ce.has(e) || de(e);
          })(n);
        }),
        c().ipcMain.on("cronUnloadImage", (e, { url: n } = {}) => {
          !(function (e) {
            se.delete(e);
          })(n);
        }),
        c().ipcMain.on("cronUnloadAllImages", () => {
          se.clear();
        }),
        c().ipcMain.on("cronSetDockIcon", (e, { url: n }) => {
          !(async function (e) {
            if (!N) return;
            const n = await de(e);
            n ? N.setIcon(n) : console.error("Failed to load dock icon:", e);
          })(n);
        }),
        c().ipcMain.on("cronPreviewFileFromString", (e, n) => {
          !(function (e) {
            if (!q) return;
            const n = c().app.getPath("cache"),
              o = x().resolve(n, e.name);
            b().writeFileSync(o, e.content), b().existsSync(o) && q.previewFile(o, e.name);
          })(n);
        }),
        c().ipcMain.on("cronOpenSystemPreferences", (e, { pane: n, section: o }) => {
          f().openSystemPreferences(n, o);
        });
    }),
    c().app.on("window-all-closed", () => {
      "linux" !== process.platform && c().app.quit();
    }),
    c().app.on("did-become-active", () => {
      var e;
      Q && ((Q = !1), null === (e = q) || void 0 === e || e.show());
    }),
    c().app.on("activate", () => {
      H();
    }),
    c().app.on("will-finish-launching", () => {
      c().app.on("open-url", (e, n) => {
        oe(n);
      });
    }),
    c().app.on("second-instance", (e, n) => {
      if ("linux" !== process.platform) return;
      H();
      const o = n.find((e) => e.startsWith("cron://"));
      var t;
      o && (null === (t = q) || void 0 === t || t.focus(), oe(o));
    });
  let te = !1,
    ie = !1;
  function ae() {
    (te = !0), c().app.quit();
  }
  function re() {
    var e, n, o;
    (ve = !0),
      null === (e = q) || void 0 === e || e.webContents.send("cronAppRunningInBackgroundChange", !0),
      null === (n = q) || void 0 === n || n.hide(),
      null === (o = q) || void 0 === o || o.webContents.send("cronBeforeQuit"),
      "linux" === process.platform && c().app.hide(),
      N && setTimeout(() => N.hide(), 500);
  }
  function le(e) {
    var n;
    (G = !1),
      null !== (n = q) && void 0 !== n && n.isFullScreen() && (q.setFullScreen(!1), (ie = !0)),
      te
        ? c().globalShortcut.unregisterAll()
        : (he || (te = !0), null == e || e.preventDefault(), re(), he || setTimeout(() => c().app.quit(), 5e3));
  }
  c().app.on("before-quit", (e) => {
    le(e);
  }),
    c().powerMonitor.on("shutdown", () => {
      ae();
    }),
    c().app.on("browser-window-focus", (e, n) => {
      var o, t, i;
      Te && ((Te = !1), null === (o = q) || void 0 === o || o.show()),
        n === Ce ? Fe && (null === (t = q) || void 0 === t || t.focus()) : Ue(!0),
        Fe && (null === (i = q) || void 0 === i || i.webContents.send("cronWindowFocus"));
    }),
    c().app.on("browser-window-blur", (e, n) => {
      var o, t;
      n === q && null !== (o = Ce) && void 0 !== o && o.isFocused() ? Ue(!0) : Ue(!1),
        Fe || null === (t = q) || void 0 === t || t.webContents.send("cronWindowBlur");
    }),
    c().ipcMain.handle("fetch", async (e, n, o = {}) => {
      var t;
      o.method = null !== (t = o.method) && void 0 !== t ? t : "get";
      const i = { url: n, ...o };
      return r()(i)
        .then((e) => ({ data: e.data, status: e.status, statusText: e.statusText, headers: e.headers }))
        .catch((e) => {
          var n;
          return e.response
            ? {
                error: null !== (n = e.response.data) && void 0 !== n ? n : e.message,
                status: e.response.status,
                statusText: e.response.statusText,
                headers: e.response.headers,
              }
            : e.request
            ? { error: e.message, status: M().IM_A_TEAPOT }
            : { error: e.message, status: M().INTERNAL_SERVER_ERROR };
        });
    }),
    c().ipcMain.handle("cronUpdateMenuItems", (e, n) => {
      for (const e of n) {
        var o;
        const { id: n } = e;
        if (!n) {
          console.warn("Tried to update Electron menu item without an ID.");
          continue;
        }
        const t = null === (o = c().Menu.getApplicationMenu()) || void 0 === o ? void 0 : o.getMenuItemById(n);
        if (!t) {
          console.warn("Tried to update Electron menu item that doesn't exist:", n);
          continue;
        }
        const i = S().omit(e, "id");
        Object.assign(t, i);
      }
    }),
    c().ipcMain.on("cronShowMenu", (e, { x: n, y: o }) => {
      var t;
      null === (t = c().Menu.getApplicationMenu()) || void 0 === t || t.popup({ x: n, y: o });
    });
  const se = new Map(),
    ce = new Set();
  async function de(e) {
    let n = se.get(e);
    if (n) return n;
    try {
      ce.add(e);
      const o = await r().get(e, { responseType: "arraybuffer" });
      if (o.data) {
        const { scaleFactor: t, templateImage: i } = (function (e) {
          let n = 1,
            o = !1;
          const t = e.match(/((Template)?@([0-9]+)x)\.(png|jpe?g)$/i);
          if (t && t.length >= 4) {
            const [, , e, i] = t;
            (o = !!e), (n = parseInt(i, 10));
          }
          return { scaleFactor: n, templateImage: o };
        })(e);
        (n = c().nativeImage.createFromBuffer(o.data, { scaleFactor: t })), n.setTemplateImage(i), se.set(e, n);
      }
    } catch (n) {
      console.error("Failed to load image at URL:", e), console.error(n);
    } finally {
      ce.delete(e);
    }
    return n;
  }
  let ue,
    pe,
    he = !1,
    ve = !1;
  async function fe(e) {
    if (e.iconURL)
      if (e.iconURL.match(/^https?:\/\//))
        try {
          var n, o;
          const t = await de(e.iconURL);
          if (!t) return void console.warn("Unable to load tray icon at URL:", e.iconURL);
          ue ||
            ((ue = new (c().Tray)(t)),
            ue.on("click", () => {
              var e;
              null === (e = q) || void 0 === e || e.webContents.send("cronTrayClick");
            }));
          const i = await me(e.contextMenu);
          i.on("menu-will-show", () => {
            var e;
            null === (e = q) || void 0 === e || e.webContents.send("cronTrayContextMenuWillShow");
          }),
            i.on("menu-will-close", () => {
              var e;
              null === (e = q) || void 0 === e || e.webContents.send("cronTrayContextMenuWillClose");
            }),
            (pe = i),
            ue.setContextMenu(i),
            ue.setImage(t),
            ue.setTitle(null !== (n = e.title) && void 0 !== n ? n : ""),
            ue.setToolTip(null !== (o = e.tooltip) && void 0 !== o ? o : "");
        } catch (e) {
          console.error(e);
        }
      else console.warn("Tray `iconURL` must start with http or https.");
    else console.warn("Cannot initialize tray without `iconURL`.");
  }
  async function me(e) {
    const n = [];
    for (const o of e) {
      const { iconURL: e, submenu: t, ...i } = o,
        a = {
          ...i,
          click: () => {
            var e;
            "cronQuitCompletely" === o.id
              ? ae()
              : null === (e = q) || void 0 === e || e.webContents.send("cronTrayContextMenuItemSelect", o);
          },
        };
      e && (a.icon = await de(e)), t && (a.submenu = await me(t)), n.push(a);
    }
    return c().Menu.buildFromTemplate(n);
  }
  function ge(e) {
    c().globalShortcut.unregister(e);
  }
  const we = new Map(),
    be = new Set();
  function ye(e) {
    if (!c().Notification.isSupported())
      return void console.log(`Failed showing desktop notification (not supported on this system): ${e}`);
    V.set(W, L);
    const { id: n } = e;
    let o = we.get(n);
    o
      ? be.add(n)
      : ((o = new (c().Notification)()),
        we.set(n, o),
        o.addListener("show", () => {
          var n;
          null === (n = q) || void 0 === n || n.webContents.send("cronNotificationShow", { notification: e });
        }),
        o.addListener("failed", (o, t) => {
          var i;
          null === (i = q) ||
            void 0 === i ||
            i.webContents.send("cronNotificationFailed", { notification: e, error: t }),
            Me(n);
        }),
        o.addListener("click", () => {
          var o;
          null === (o = q) || void 0 === o || o.webContents.send("cronNotificationClick", { notification: e }), Me(n);
        }),
        o.addListener("action", (o, t) => {
          if (!e.actions || e.actions.length <= t) return;
          const i = e.actions[t];
          var a;
          i &&
            (null === (a = q) ||
              void 0 === a ||
              a.webContents.send("cronNotificationActionSelect", { notification: { ...e }, actionId: i.id })),
            Me(n);
        }),
        o.addListener("close", () => {
          Me(n);
        }),
        o.addListener("reply", (o, t) => {
          var i;
          null === (i = q) ||
            void 0 === i ||
            i.webContents.send("cronNotificationReply", { notification: e, reply: t }),
            Me(n);
        })),
      (o.title = e.title),
      (o.body = e.body),
      (o.silent = e.silent || !1),
      (o.hasReply = e.hasReply || !1),
      (o.replyPlaceholder = e.replyPlaceholder || ""),
      e.actions && e.actions.length > 0
        ? (o.actions = e.actions.map((e) => ({ type: "button", text: e.title })))
        : (o.actions = []),
      o.show();
  }
  function Me(e) {
    if (be.has(e)) return void be.delete(e);
    const n = we.get(e);
    var o;
    n &&
      (n.removeAllListeners(),
      we.delete(e),
      null === (o = q) || void 0 === o || o.webContents.send("cronNotificationClose", { id: e }));
  }
  let Ce,
    Se,
    ke,
    xe = { width: 0, height: 0 },
    Ie = !1,
    Fe = !1,
    Te = !1;
  function Le() {
    if (Ce) {
      Ie = !0;
      const { width: e, height: n } = xe;
      Re(e, n), !N || N.isVisible() ? Ce.showInactive() : Ce.show();
    }
  }
  function Ae() {
    var e;
    (Ce = void 0), (Ie = !1), null === (e = q) || void 0 === e || e.webContents.send("cronNotificationsWindowClosed");
  }
  function Re(e, n) {
    if (Ce) {
      const o = (function (e, n, o) {
        var t, i;
        const a = c().screen.getPrimaryDisplay().workArea,
          r =
            null !== (t = null === (i = ue) || void 0 === i ? void 0 : i.getBounds()) && void 0 !== t
              ? t
              : { x: 0, y: 0, width: 0, height: 0 },
          l = { width: n, height: o };
        let s = { x: a.x, y: a.y };
        switch (e) {
          case "topLeft":
            (s.x = a.x), (s.y = a.y);
            break;
          case "topRight":
            (s.x = Math.floor(a.x + (a.width - n))), (s.y = a.y);
            break;
          case "topCenter":
            (s.x = Math.floor(a.x + (a.width / 2 - n / 2))), (s.y = a.y);
            break;
          case "bottomLeft":
            (s.x = a.x), (s.y = Math.floor(a.height - (o - a.y)));
            break;
          case "bottomRight":
            (s.x = Math.floor(a.x + (a.width - n))), (s.y = Math.floor(a.height - (o - a.y)));
            break;
          case "bottomCenter":
            (s.x = Math.floor(a.x + (a.width / 2 - n / 2))), (s.y = Math.floor(a.height - (o - a.y)));
            break;
          case "leftCenter":
            (s.x = a.x), (s.y = a.y + Math.floor(a.height / 2) - Math.floor(o / 2));
            break;
          case "rightCenter":
            (s.x = Math.floor(a.x + (a.width - n))), (s.y = a.y + Math.floor(a.height / 2) - Math.floor(o / 2));
            break;
          case "center":
            (s.x = Math.floor(a.x + (a.width / 2 - n / 2))), (s.y = Math.floor((a.height + a.y) / 2 - o / 2));
            break;
          case "trayLeft":
            (s.x = Math.floor(r.x)), (s.y = a.y);
            break;
          case "trayRight":
            (s.x = Math.floor(r.x - n + r.width)), (s.y = a.y);
            break;
          case "trayCenter":
            (s.x = Math.floor(r.x - n / 2 + r.width / 2)), (s.y = a.y);
            break;
          case "trayBottomLeft":
            (s.x = Math.floor(r.x)), (s.y = Math.floor(a.height - (o - a.y)));
            break;
          case "trayBottomRight":
            (s.x = Math.floor(r.x - n + r.width)), (s.y = Math.floor(a.height - (o - a.y)));
            break;
          case "trayBottomCenter":
            (s.x = Math.floor(r.x - n / 2 + r.width / 2)), (s.y = Math.floor(a.height - (o - a.y)));
        }
        return { ...s, ...l };
      })("linux" === process.platform ? "topRight" : "bottomRight", e, n);
      Ce.setBounds(o);
    }
  }
  function Ue(e) {
    var n, o;
    if (
      ((Fe = e),
      !e || (null !== (n = q) && void 0 !== n && n.isFocused()) || null === (o = q) || void 0 === o || o.focus(),
      Ce)
    ) {
      const e = De();
      Ce.setFocusable(e);
    }
  }
  function De() {
    return !Fe;
  }
  let We = !1;
  c().ipcMain.handle("cronCheckForUpdates", () => qe()),
    c().ipcMain.handle("cronQuitAndInstallUpdate", () => c().autoUpdater.quitAndInstall());
  const Oe = (e, ...n) => {
      var o;
      null === (o = q) ||
        void 0 === o ||
        o.webContents.send(
          {
            error: "cronUpdateError",
            "checking-for-update": "cronCheckingForUpdate",
            "update-available": "cronUpdateAvailable",
            "update-not-available": "cronUpdateNotAvailable",
            "update-downloaded": "cronUpdateDownloaded",
            "before-quit-for-update": "cronBeforeQuitForUpdate",
          }[e],
          ...n
        );
    },
    qe = async () => {
      if ("checking-for-update" === Se || "update-downloaded" === Se)
        return void Oe(Se, ...("update-downloaded" === Se ? [ke, We] : []));
      let e;
      (Se = "checking-for-update"), Oe(Se);
      try {
        e = await i().autoUpdater.checkForUpdates();
      } catch (e) {
        return (Se = "error"), void Oe(Se, e);
      }
      if (e.updateInfo) {
        Se = "update-downloaded";
        try {
          const e = (await r().get(`${A}/config.json`)).data.minimumElectronVersion.version;
          We = l.compare(e, c().app.getVersion(), ">");
        } catch (e) {
          We = !1;
        }
        (ke = e.updateInfo.version), Oe(Se, ke, We);
      } else (Se = "update-not-available"), Oe(Se);
    },
    ze = async () => {
      i().autoUpdater.on("before-quit-for-update", () => {
        (te = !0), le(), (Se = "before-quit-for-update"), Oe(Se);
      }),
        i().autoUpdater.on("update-available", () => {
          (Se = "update-available"), Oe(Se);
        }),
        qe(),
        setInterval(qe, 9e5);
    };
})();
