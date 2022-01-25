/*! For license information please see preload-bundle.js.LICENSE.txt */
(() => {
  "use strict";
  var e = {
    n: (r) => {
      var n = r && r.__esModule ? () => r.default : () => r;
      return e.d(n, { a: n }), n;
    },
    d: (r, n) => {
      for (var o in n) e.o(n, o) && !e.o(r, o) && Object.defineProperty(r, o, { enumerable: !0, get: n[o] });
    },
    o: (e, r) => Object.prototype.hasOwnProperty.call(e, r),
  };
  const r = require("electron"),
    n = require("os");
  var o = e.n(n),
    t = {
      bridgeVersion: "1.0",
      platform: { name: o().platform(), version: o().release() },
      ipcOn: function (e, r) {
        return t.ipcAddListener(e, r);
      },
      ipcAddListener: function (e, n) {
        var o = function (e) {
          for (var r = arguments.length, o = new Array(r > 1 ? r - 1 : 0), t = 1; t < r; t++) o[t - 1] = arguments[t];
          n.apply(void 0, [e].concat(o));
        };
        return (
          r.ipcRenderer.addListener(e, o),
          function () {
            r.ipcRenderer.removeListener(e, o);
          }
        );
      },
      ipcRemoveAllListeners: function (e) {
        r.ipcRenderer.removeAllListeners(e);
      },
      ipcSend: function (e) {
        for (var n = arguments.length, o = new Array(n > 1 ? n - 1 : 0), t = 1; t < n; t++) o[t - 1] = arguments[t];
        r.ipcRenderer.send.apply(r.ipcRenderer, [e].concat(o));
      },
      ipcInvoke: function (e) {
        for (var n = arguments.length, o = new Array(n > 1 ? n - 1 : 0), t = 1; t < n; t++) o[t - 1] = arguments[t];
        return r.ipcRenderer.invoke.apply(r.ipcRenderer, [e].concat(o));
      },
      openURL: function (e, n) {
        return r.shell.openExternal(e, n);
      },
      getWindowZoomFactor: function () {
        return r.webFrame.getZoomFactor();
      },
    };
  r.contextBridge.exposeInMainWorld("electron", t);
})();
