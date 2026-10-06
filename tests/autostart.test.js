const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const { createAutostart } = require("../autostart.js");
const { readDesktopEntry } = require("../desktop-entry.js");
const execFileAsync = promisify(execFile);

function setup(t, { argv = [], name = "norc" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "norc-autostart-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, name);
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_CONFIG_DIRS: path.join(directory, "system"), XDG_CURRENT_DESKTOP: "KDE" };
  const filename = path.join(env.XDG_CONFIG_HOME, "autostart/norc.desktop");
  const autostart = createAutostart({ command: [executable], env, argv });
  return { directory, executable, env, filename, autostart };
}

test("autostart persists enable/disable state across instances and only manages Norc's entry", t => {
  const state = setup(t);
  assert.equal(state.autostart.getLoginItemSettings().openAtLogin, false);
  state.autostart.setLoginItemSettings({ openAtLogin: true });
  const next = createAutostart({ command: [state.executable], env: state.env, argv: [] });
  assert.equal(next.getLoginItemSettings().openAtLogin, true);
  assert.match(readDesktopEntry(state.filename).Exec, /norc" "--from-login"/);
  const other = path.join(path.dirname(state.filename), "other.desktop");
  fs.writeFileSync(other, "Other startup settings\n");
  next.setLoginItemSettings({ openAtLogin: false });
  assert.equal(fs.existsSync(state.filename), false);
  assert.equal(next.getLoginItemSettings().openAtLogin, false);
  assert.equal(fs.readFileSync(other, "utf8"), "Other startup settings\n");
});

test("hidden and visible startup preferences survive restart and mark login launches", t => {
  const state = setup(t, { argv: ["norc", "--from-login", "--norc-start-hidden"] });
  state.autostart.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  assert.deepEqual(state.autostart.getLoginItemSettings(), { openAtLogin: true, openAsHidden: true, wasOpenedAtLogin: true });
  assert.match(readDesktopEntry(state.filename).Exec, /"--from-login" "--norc-start-hidden"$/);
  state.autostart.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  assert.equal(state.autostart.getLoginItemSettings().openAsHidden, false);
  assert.doesNotMatch(readDesktopEntry(state.filename).Exec, /--norc-start-hidden/);
});

test("disabling system-wide Norc autostart creates a user override", t => {
  const state = setup(t);
  const systemFile = path.join(state.env.XDG_CONFIG_DIRS, "autostart/norc.desktop");
  fs.mkdirSync(path.dirname(systemFile), { recursive: true });
  fs.writeFileSync(systemFile, `[Desktop Entry]\nType=Application\nExec=${state.executable}\n`);
  assert.equal(state.autostart.getLoginItemSettings().openAtLogin, true);
  state.autostart.setLoginItemSettings({ openAtLogin: false });
  assert.equal(readDesktopEntry(state.filename).Hidden, "true");
  assert.equal(state.autostart.getLoginItemSettings().openAtLogin, false);
  assert.equal(fs.existsSync(systemFile), true);
});

test("externally disabled or desktop-restricted entries are reported accurately", t => {
  const state = setup(t);
  state.autostart.setLoginItemSettings({ openAtLogin: true });
  const initial = fs.readFileSync(state.filename, "utf8");
  for (const setting of ["Hidden=true", "X-GNOME-Autostart-enabled=false", "OnlyShowIn=GNOME;", "NotShowIn=KDE;", "TryExec=/missing/norc"]) {
    fs.writeFileSync(state.filename, `${initial}\n${setting}\n`);
    assert.equal(state.autostart.getLoginItemSettings().openAtLogin, false, setting);
  }
  fs.writeFileSync(state.filename, `${initial}\nOnlyShowIn=KDE;XFCE;\n`);
  assert.equal(state.autostart.getLoginItemSettings().openAtLogin, true);
});

test("failed replacement leaves no partial startup entry or temporary file", t => {
  const state = setup(t);
  fs.mkdirSync(state.filename, { recursive: true });
  assert.throws(() => state.autostart.setLoginItemSettings({ openAtLogin: true }));
  assert.equal(state.autostart.getLoginItemSettings().openAtLogin, false);
  assert.deepEqual(fs.readdirSync(path.dirname(state.filename)), ["norc.desktop"]);
});

test("GIO executes generated autostart entries with special characters as literal arguments", async t => {
  const state = setup(t, { name: 'norc space $`"%\\' });
  const output = path.join(state.directory, "arguments.json");
  fs.writeFileSync(state.executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.NORC_TEST_OUTPUT, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const args = ['literal $() `command` "quoted" % \\'];
  const autostart = createAutostart({ command: [state.executable, ...args], env: state.env, argv: [] });
  autostart.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  assert.equal(autostart.getLoginItemSettings().openAtLogin, true);
  try {
    await execFileAsync("gio", ["launch", state.filename], { env: { ...state.env, NORC_TEST_OUTPUT: output }, timeout: 5000 });
  } catch (error) {
    if (error.code === "ENOENT") { t.skip("GIO is unavailable"); return; }
    throw error;
  }
  for (let i = 0; !fs.existsSync(output) && i < 40; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), [...args, "--from-login", "--norc-start-hidden"]);
});
