const assert = require("node:assert/strict");
const test = require("node:test");
const { openSystemSettings } = require("../system-settings.js");

function setup(desktop, { server = "", uriHandler = "", missing = [] } = {}) {
  const calls = [];
  const reads = [];
  const launchEnvironments = [];
  const options = {
    env: { XDG_CURRENT_DESKTOP: desktop },
    async launch(command, args, env) {
      calls.push([command, ...args]);
      launchEnvironments.push(env);
      if (missing.includes(command) || missing.includes([command, ...args].join(" "))) throw new Error("Unavailable");
    },
    async read(command, args) {
      reads.push([command, ...args]);
      return command === "gdbus" ? server : uriHandler;
    },
  };
  return { options, calls, reads, launchEnvironments };
}

test("notification settings use the current desktop even with other desktops installed", async () => {
  for (const [desktop, command] of [
    ["KDE", ["systemsettings", "kcm_notifications"]],
    ["GNOME", ["gnome-control-center", "notifications"]],
    ["XFCE", ["xfce4-notifyd-config"]],
    ["X-Cinnamon:GNOME", ["cinnamon-settings", "notifications"]],
    ["MATE", ["mate-notification-properties"]],
    ["LXQt", ["lxqt-config-notificationd"]],
    ["Budgie:GNOME", ["budgie-control-center", "notifications"]],
  ]) {
    const state = setup(desktop);
    await openSystemSettings("notifications", state.options);
    assert.deepEqual(state.calls, [command]);
    assert.deepEqual(state.reads, []);
  }
});

test("desktop session and notification server can identify a desktop when variables are missing", async () => {
  const session = setup("");
  session.options.env.DESKTOP_SESSION = "plasmawayland";
  await openSystemSettings("notifications", session.options);
  assert.deepEqual(session.calls, [["systemsettings", "kcm_notifications"]]);
  assert.deepEqual(session.reads, []);
  assert.equal(session.launchEnvironments[0].XDG_CURRENT_DESKTOP, "KDE");
  const server = setup("", { server: "('gnome-shell', 'GNOME', '50.5', '1.2')" });
  await openSystemSettings("notifications", server.options);
  assert.deepEqual(server.calls, [["gnome-control-center", "notifications"]]);
  assert.equal(server.launchEnvironments[0].XDG_CURRENT_DESKTOP, "GNOME");
  assert.equal(server.options.env.XDG_CURRENT_DESKTOP, "");
});

test("older Plasma tools and general desktop settings provide fallbacks", async () => {
  const kde = setup("KDE", { missing: ["systemsettings", "kcmshell6"] });
  await openSystemSettings("notifications", kde.options);
  assert.deepEqual(kde.calls.at(-1), ["systemsettings5", "kcm_notifications"]);
  const xfce = setup("XFCE", { missing: ["xfce4-notifyd-config"] });
  await openSystemSettings("notifications", xfce.options);
  assert.deepEqual(xfce.calls, [["xfce4-notifyd-config"], ["xfce4-settings-manager"]]);
});

test("other panes open general settings without passing arbitrary arguments", async () => {
  const state = setup("KDE");
  await openSystemSettings("notifications; touch /tmp/unsafe", state.options);
  assert.deepEqual(state.calls, [["systemsettings"]]);
});

test("a registered settings URI supports other desktops", async () => {
  const state = setup("Pantheon", { uriHandler: "io.elementary.switchboard.desktop" });
  await openSystemSettings("notifications", state.options);
  assert.deepEqual(state.calls, [["xdg-open", "settings://notifications"]]);
});

test("unknown desktops without a URI handler fail without opening an unrelated settings app", async () => {
  const state = setup("sway", { server: "('dunst', 'knopwob', '1.13', '1.2')" });
  await assert.rejects(openSystemSettings("notifications", state.options), /No compatible system settings/);
  assert.deepEqual(state.calls, []);
});
