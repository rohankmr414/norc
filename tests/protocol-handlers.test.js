const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { isProtocolRegistered } = require("../protocol-handlers.js");

function setup(t, { handler = "zoom.desktop", gio = "" } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "norc-protocols-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    XDG_DATA_HOME: path.join(directory, "user"),
    XDG_DATA_DIRS: path.join(directory, "system"),
    XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_CONFIG_DIRS: path.join(directory, "system-config"),
    XDG_CURRENT_DESKTOP: "X-Norc-Test",
  };
  const executable = path.join(directory, "zoom");
  fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const calls = [];
  function writeEntry(
    id = handler,
    content = `Type=Application\nExec=${executable}\n`,
    root = env.XDG_DATA_HOME,
  ) {
    const filename = path.join(root, "applications", id);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, `[Desktop Entry]\n${content}`);
    return filename;
  }
  const options = {
    env,
    read: async (command, args, childEnv) => {
      calls.push({ command, args, env: childEnv });
      return command === "xdg-mime" ? handler : gio;
    },
  };
  return { directory, executable, env, options, calls, writeEntry };
}

test("installed handlers are detected without changing associations or launching them", async (t) => {
  const state = setup(t);
  state.writeEntry("zoom.desktop", `Type=Application\nNoDisplay=true\nExec=${state.executable}\n`);
  assert.equal(await isProtocolRegistered("zoommtg:", state.options), true);
  assert.deepEqual(
    state.calls.map(({ command, args }) => [command, ...args]),
    [["xdg-mime", "query", "default", "x-scheme-handler/zoommtg"]],
  );
});

test("missing, disabled and stale executables are not treated as registered handlers", async (t) => {
  const state = setup(t);
  assert.equal(await isProtocolRegistered("zoommtg", state.options), false);
  for (const content of [
    `Type=Application\nHidden=true\nExec=${state.executable}\n`,
    "Type=Application\nExec=/missing/zoom\n",
    `Type=Application\nTryExec=/missing/zoom\nExec=${state.executable}\n`,
    "Type=Application\n",
    `Type=Link\nExec=${state.executable}\n`,
  ]) {
    state.writeEntry("zoom.desktop", content);
    assert.equal(await isProtocolRegistered("zoommtg", state.options), false, content);
  }
});

test("user desktop overrides take precedence over system registrations", async (t) => {
  const state = setup(t);
  state.writeEntry(
    "zoom.desktop",
    `Type=Application\nExec=${state.executable}\n`,
    state.env.XDG_DATA_DIRS,
  );
  assert.equal(await isProtocolRegistered("zoommtg", state.options), true);
  state.writeEntry("zoom.desktop", "Type=Application\nHidden=true\n");
  assert.equal(await isProtocolRegistered("zoommtg", state.options), false);
});

test("desktop IDs resolve nested application entries and quoted executable paths", async (t) => {
  const state = setup(t, { handler: "vendor-zoom.desktop" });
  const executable = path.join(state.directory, "zoom client");
  fs.copyFileSync(state.executable, executable);
  state.writeEntry("vendor/zoom.desktop", `Type=Application\nExec="${executable}" %u\n`);
  assert.equal(await isProtocolRegistered("zoommtg", state.options), true);
});

test("GIO detects handlers when xdg-utils is missing, using a child-only C locale", async (t) => {
  const state = setup(t, {
    gio: "Default application for “x-scheme-handler/notion”: notion.desktop\nRegistered applications:\n  notion.desktop",
  });
  state.writeEntry("notion.desktop");
  const read = state.options.read;
  state.options.read = async (...args) => {
    if (args[0] === "xdg-mime") throw Object.assign(new Error("Unavailable"), { code: "ENOENT" });
    return read(...args);
  };
  state.env.LC_ALL = "fr_FR.UTF-8";
  assert.equal(await isProtocolRegistered("notion", state.options), true);
  assert.equal(state.calls[0].command, "gio");
  assert.equal(state.calls[0].env.LC_ALL, "C");
  assert.equal(state.env.LC_ALL, "fr_FR.UTF-8");
});

test("PATH executables and D-Bus activatable entries are valid handlers", async (t) => {
  const state = setup(t);
  state.env.PATH = state.directory;
  state.writeEntry("zoom.desktop", "Type=Application\nExec=zoom %u\n");
  assert.equal(await isProtocolRegistered("zoommtg", state.options), true);
  state.writeEntry("zoom.desktop", "Type=Application\nDBusActivatable=true\n");
  assert.equal(await isProtocolRegistered("zoommtg", state.options), true);
});

test("invalid schemes and desktop IDs cannot inject command arguments or traverse directories", async (t) => {
  const state = setup(t, { handler: "../outside.desktop" });
  for (const scheme of [
    undefined,
    {},
    "",
    "--help",
    "zoommtg; touch /tmp/unsafe",
    "notion\nhttp",
    "https://example.com",
  ]) {
    assert.equal(await isProtocolRegistered(scheme, state.options), false);
  }
  assert.equal(state.calls.length, 0);
  assert.equal(await isProtocolRegistered("notion", state.options), false);
  assert.equal(state.calls.length, 2);
});

test("real XDG lookup reads an isolated registration without modifying desktop defaults", async (t) => {
  const state = setup(t, { handler: "norc-protocol-test.desktop" });
  state.writeEntry();
  fs.mkdirSync(state.env.XDG_CONFIG_HOME, { recursive: true });
  const defaults =
    "[Default Applications]\nx-scheme-handler/norc-protocol-test=norc-protocol-test.desktop;\n";
  const filename = path.join(state.env.XDG_CONFIG_HOME, "mimeapps.list");
  fs.writeFileSync(filename, defaults);
  assert.equal(await isProtocolRegistered("norc-protocol-test", { env: state.env }), true);
  assert.equal(fs.readFileSync(filename, "utf8"), defaults);
});
