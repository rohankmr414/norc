const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../file-preview.js"), "utf8");

function setup({ load = async () => {}, createError, dialogError } = {}) {
  const parent = new EventEmitter();
  parent.destroyed = false;
  parent.isDestroyed = () => parent.destroyed;
  parent.destroy = () => {
    parent.destroyed = true;
    parent.emit("closed");
  };
  const windows = [],
    messages = [],
    warnings = [],
    fileOpens = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      if (createError) throw createError;
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openWindow = handler;
      };
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit("closed");
      }
    }
    close() {
      this.destroy();
    }
    show() {
      this.shown = true;
    }
    async loadURL(url) {
      this.url = url;
      await load();
    }
    get html() {
      return decodeURIComponent(this.url.split(",").slice(1).join(","));
    }
  }
  const context = {
    module: { exports: {} },
    console: { warn: (...args) => warnings.push(args) },
    require(name) {
      if (name === "electron")
        return {
          BrowserWindow,
          dialog: {
            showMessageBox: async (owner, message) => {
              assert.equal(owner, parent);
              messages.push(message);
              if (dialogError) throw dialogError;
            },
          },
        };
      if (name === "node:fs/promises")
        return {
          open: async (...args) => {
            fileOpens.push(args[0]);
            return fs.open(...args);
          },
        };
      return require(name);
    },
  };
  vm.runInNewContext(source, context, { filename: "file-preview.js" });
  return { ...context.module.exports, parent, windows, messages, warnings, fileOpens };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "norc-preview-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("diagnostic previews display literal text in an isolated window without opening a disk file", async () => {
  const state = setup();
  const name = '<img src="https://example.com/track">.json';
  const content = '{"summary":"Lunch ☕ & tea","markup":"</pre><script>alert(1)</script>"}';
  await state.previewFromString(state.parent, { name, content, contentType: "application/json" });
  const [window] = state.windows;
  assert.ok(window.shown);
  assert.equal(window.options.parent, state.parent);
  assert.equal(window.options.webPreferences.javascript, false);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.partition, "norc-file-preview");
  assert.match(window.html, /&lt;img src=&quot;https:\/\/example.com\/track&quot;&gt;\.json/);
  assert.match(window.html, /Lunch ☕ &amp; tea/);
  assert.match(window.html, /&lt;\/pre&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(window.html, /<script|<img/);
  assert.match(window.html, /default-src 'none'/);
  assert.deepEqual(state.fileOpens, []);
  assert.deepEqual(state.messages, []);
});

test("an empty attachment remains previewable and missing display names get a useful title", async () => {
  const state = setup();
  await state.previewFromString(state.parent, { content: "" });
  assert.equal(state.windows[0].options.title, "Feedback attachment — Norc");
  assert.match(state.windows[0].html, /<pre><\/pre>/);
});

test("path previews read the original file and leave it unchanged when closed", async (t) => {
  const directory = await fixture(t);
  const filename = path.join(directory, "debug #✓.json");
  const content = '{\r\n  "summary": "Lunch ☕"\r\n}\r\n';
  await fs.writeFile(filename, content, { mode: 0o600 });
  const state = setup();
  await state.previewFromPath(state.parent, { path: filename });
  const [window] = state.windows;
  assert.ok(window.shown);
  assert.equal(window.options.title, "debug #✓.json — Norc");
  assert.match(window.html, /\{\r\n  &quot;summary&quot;: &quot;Lunch ☕&quot;\r\n\}\r\n/);
  window.close();
  assert.equal(await fs.readFile(filename, "utf8"), content);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.equal(state.parent.listenerCount("closed"), 0);
});

test("bad attachment payloads and missing or non-file paths show errors without creating a preview", async (t) => {
  const directory = await fixture(t);
  const state = setup();
  for (const attachment of [null, {}, { content: {} }])
    await state.previewFromString(state.parent, attachment);
  for (const attachment of [
    null,
    { path: "relative.json" },
    { path: path.join(directory, "missing.json") },
    { path: directory },
  ]) {
    await state.previewFromPath(state.parent, attachment);
  }
  assert.equal(state.messages.length, 7);
  assert.ok(state.messages.every((message) => message.message === "Could not preview attachment"));
  assert.deepEqual(state.windows, []);
});

test("unreadable path previews report a failure and preserve file permissions", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can read mode-000 files");
    return;
  }
  const directory = await fixture(t);
  const filename = path.join(directory, "private.json");
  await fs.writeFile(filename, "{}", { mode: 0o000 });
  const state = setup();
  try {
    await state.previewFromPath(state.parent, { path: filename });
    assert.equal(state.messages.length, 1);
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o000);
    assert.deepEqual(state.windows, []);
  } finally {
    await fs.chmod(filename, 0o600);
  }
});

test("window creation and page-load failures show errors and release the failed window", async () => {
  for (const options of [
    { createError: new Error("Cannot create window") },
    {
      load: async () => {
        throw new Error("Load failed");
      },
    },
  ]) {
    const state = setup(options);
    await state.previewFromString(state.parent, { name: "debug.json", content: "{}" });
    assert.equal(state.messages.length, 1);
    assert.ok(state.windows.every((window) => window.isDestroyed() && !window.shown));
    assert.equal(state.parent.listenerCount("closed"), 0);
  }
});

test("preview windows block navigation and support Escape and Ctrl+W without closing the calendar", async () => {
  for (const input of [
    { type: "keyDown", key: "Escape" },
    { type: "keyDown", key: "W", control: true },
  ]) {
    const state = setup();
    await state.previewFromString(state.parent, { name: "debug.json", content: "{}" });
    const [window] = state.windows;
    assert.equal(window.openWindow({ url: "https://example.com" }).action, "deny");
    let prevented = 0;
    const event = {
      preventDefault() {
        prevented++;
      },
    };
    window.webContents.emit("will-navigate", event, "https://example.com");
    window.webContents.emit("before-input-event", event, input);
    assert.equal(prevented, 2);
    assert.ok(window.isDestroyed());
    assert.equal(state.parent.isDestroyed(), false);
    assert.equal(state.parent.listenerCount("closed"), 0);
  }
});

test("closing the calendar while a preview loads closes the child without showing an error", async () => {
  let finish;
  const state = setup({
    load: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const loading = state.previewFromString(state.parent, { name: "debug.json", content: "{}" });
  state.parent.destroy();
  finish();
  await loading;
  assert.ok(state.windows[0].isDestroyed());
  assert.equal(state.windows[0].shown, undefined);
  assert.deepEqual(state.messages, []);
  await state.previewFromPath(state.parent, { path: "/missing.json" });
  await state.previewFromString(null, { content: "{}" });
  assert.deepEqual(state.fileOpens, []);
});

test("an unavailable error dialog does not leave an unhandled preview rejection", async () => {
  const state = setup({ dialogError: new Error("No dialog available") });
  await state.previewFromString(state.parent, {});
  assert.equal(state.warnings.length, 2);
});
