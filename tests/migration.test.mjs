import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { LinuxTargetHelper } from "app-builder-lib/out/targets/LinuxTargetHelper.js";
import { buildApp } from "../scripts/build.mjs";
import { artifactNames, readJson, writeJson } from "../scripts/common.mjs";
import { extractIcons, prepareApp } from "../scripts/extract.mjs";
import { patchApp } from "../scripts/patch.mjs";
import { syncIcons } from "../scripts/icons.mjs";

const reminderSource = 'const fullScreen=false;function reminderOptions(){return {type:`panel`,alwaysOnTop:!0,focusable:reminderFocusable()}}function reminderFocusable(){return process.platform===`darwin`?!fullScreen:!0}function reminderPosition(position){return position??(process.platform===`darwin`?`topRight`:`bottomRight`)}';
const integrationSource = 'function allowed(e){return [`notion`,`zoommtg`].includes(e)}async function macHandler(e){return `mac:${e}`}async function windowsHandler(e){return `windows:${e}`}async function protocolRegistered(e){return allowed(e)?process.platform===`darwin`?macHandler(e):process.platform===`win32`?windowsHandler(e):!1:!1}function legacyLogin(){return !1}function loginSettings(){let settings=loginApp.getLoginItemSettings();return legacyLogin()||(settings.openAsHidden=preferences.get(hiddenKey)===!0),settings}function launchedAtLogin(){return process.argv.includes(`--from-login`)}const startupHandled=false;function startupHidden(){return loginSettings().openAsHidden&&launchedAtLogin()&&!startupHandled}';

async function fixture(t) {
  const output = await mkdtemp(path.join(os.tmpdir(), "norc-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(output, "build/main"), { recursive: true });
  await mkdir(path.join(output, "build/preload"), { recursive: true });
  await writeJson(path.join(output, "package.json"), {
    name: "notion-calendar-web", version: "1.139.0", dependencies: { "electron-store": "5.2.0" },
    packageManager: "pnpm@11.5.2", config: { forge: {} },
  });
  await writeJson(path.join(output, ".norc-upstream.json"), { version: "1.139.0", electronVersion: "41.5.0" });
  await writeFile(path.join(output, "build/main/main.js"),
    'const options={title:`Cron`};process.platform===`darwin`;process.platform===`win32`;' + reminderSource + integrationSource);
  await writeFile(path.join(output, "build/preload/preload-bundle.js"),
    'const windows=process.platform===`win32`;const api={usesNativeMacOsTrafficLight:!0};');
  return output;
}
async function snapshot(directory) {
  const files = {};
  for (const filename of (await readdir(directory, { recursive: true })).sort()) {
    try { files[filename] = await readFile(path.join(directory, filename), "utf8"); }
    catch (error) { if (error.code !== "EISDIR") throw error; }
  }
  return files;
}
test("packages preserve the Norc identity, upstream version, runtime and OAuth protocol", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const data = await readJson(path.join(output, "package.json"));
  assert.equal(data.name, "norc");
  assert.equal(data.productName, "Norc");
  assert.equal(data.desktopName, "norc.desktop");
  assert.equal(data.version, "1.139.0");
  assert.equal(data.build.linux.executableName, "norc");
  assert.deepEqual(data.dependencies, { "electron-store": "5.2.0" });
  assert.equal(data.devDependencies.electron, "41.5.0");
  assert.deepEqual(data.build.protocols[0].schemes, ["cron"]);
  assert.deepEqual(data.build.linux.target, ["deb", "pacman", "rpm"]);
  assert.deepEqual(data.build.linux.mimeTypes, ["text/calendar", "text/x-vcalendar"]);
  assert.equal(data.build.rpm.artifactName, "norc-1.139.0-1.x86_64.rpm");
  assert.equal(data.build.rpm.afterRemove, path.join(output, ".norc-rpm/after-remove.sh"));
  assert.deepEqual(data.build.rpm.fpm, ["--rpm-posttrans", path.join(output, ".norc-rpm/post-transaction.sh")]);
  assert.equal(data.build.deb.afterRemove, undefined);
  assert.equal(data.build.pacman.afterRemove, undefined);
  assert.equal(data.build.pacman.artifactName, "norc-1.139.0-1-x86_64.pkg.tar.xz");
  assert.equal(data.packageManager, undefined);
  assert.equal(data.config, undefined);
  assert.equal((await readJson(path.join(output, "build/main/upstream.json"))).version, "1.139.0");
  assert.match(await readFile(path.join(output, "build/main/main.js"), "utf8"), /title:`Norc`.*platform===`darwin`/);
  assert.match(await readFile(path.join(output, "build/preload/preload-bundle.js"), "utf8"), /platform===`linux`/);
  for (const filename of ["autostart.js", "desktop-entry.js", "protocol-handlers.js", "calendar-files.js"]) {
    assert.equal(await readFile(path.join(output, "build/main", filename), "utf8"), await readFile(new URL(`../${filename}`, import.meta.url), "utf8"));
  }
});
test("desktop integration advertises calendar files and retains OAuth URL arguments", async t => {
  const output = await fixture(t);
  await patchApp({ output });
  const data = await readJson(path.join(output, "package.json"));
  const helper = {
    packager: {
      appInfo: { productName: "Norc", sanitizedProductName: "Norc" }, executableName: "norc",
      info: { metadata: data }, config: data.build, platformSpecificBuildOptions: data.build.linux, fileAssociations: [],
    },
    getDescription: () => data.description,
  };
  const desktop = await LinuxTargetHelper.prototype.computeDesktopEntry.call(helper, data.build.linux);
  assert.match(desktop, /^Exec=\/opt\/Norc\/norc %U$/m);
  assert.match(desktop, /^MimeType=text\/calendar;text\/x-vcalendar;x-scheme-handler\/cron;$/m);
});
test("protocol patch uses Linux lookup while preserving the allowlist and upstream platforms", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const [platform, expected] of [["linux", "linux:notion"], ["darwin", "mac:notion"], ["win32", "windows:notion"]]) {
    const calls = [];
    const context = vm.createContext({ process: { platform }, require: filename => {
      assert.equal(filename, "./protocol-handlers.js");
      return { isProtocolRegistered: async scheme => { calls.push(scheme); return `linux:${scheme}`; } };
    } });
    vm.runInContext(source, context);
    assert.equal(await vm.runInContext('protocolRegistered("notion")', context), expected);
    assert.equal(await vm.runInContext('protocolRegistered("javascript")', context), false);
    assert.deepEqual(calls, platform === "linux" ? ["notion"] : []);
  }
});
test("Linux startup reads the actual hidden preference instead of upstream's cached value", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const platform of ["linux", "darwin", "win32"]) {
    const context = vm.createContext({
      process: { platform }, hiddenKey: "hidden", preferences: { get: () => false },
      loginApp: { getLoginItemSettings: () => ({ openAtLogin: true, openAsHidden: true, wasOpenedAtLogin: true }) },
    });
    vm.runInContext(source, context);
    assert.equal(vm.runInContext("loginSettings().openAsHidden", context), platform === "linux");
    assert.equal(vm.runInContext("loginSettings().wasOpenedAtLogin", context), true);
  }
});
test("Linux background startup follows launch flags without hiding normal or visible login launches", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const [argv, expected] of [
    [["norc"], false], [["norc", "--from-login"], false],
    [["norc", "--norc-start-hidden"], false], [["norc", "--from-login", "--norc-start-hidden"], true],
  ]) {
    const context = vm.createContext({ process: { platform: "linux", argv },
      loginApp: { getLoginItemSettings: () => ({ openAsHidden: false }) } });
    vm.runInContext(source, context);
    assert.equal(vm.runInContext("startupHidden()", context), expected);
  }
});
test("changed protocol lookup fails before modifying the extraction", async (t) => {
  const output = await fixture(t);
  const main = path.join(output, "build/main/main.js");
  await writeFile(main, (await readFile(main, "utf8")).replace('windowsHandler(e):!1:!1', 'windowsHandler(e):false:false'));
  const before = await snapshot(output);
  await assert.rejects(patchApp({ output }), /protocol lookup changed/);
  assert.deepEqual(await snapshot(output), before);
});
test("patching can be repeated or upgraded without losing the upstream version", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const first = await snapshot(output);
  await patchApp({ output });
  assert.deepEqual(await snapshot(output), first);
  const main = path.join(output, "build/main/main.js");
  await writeFile(main, (await readFile(main, "utf8")).replace('process.platform===`linux`?`topRight`:', 'process.platform===`linux`?`topLeft`:'));
  await patchApp({ output });
  assert.deepEqual(await snapshot(output), first);
  await writeJson(path.join(output, ".norc-upstream.json"), { version: "1.140.0", electronVersion: "41.5.0" });
  await patchApp({ output, arch: "arm64" });
  const data = await readJson(path.join(output, "package.json"));
  assert.equal(data.version, "1.140.0");
  assert.equal(data.build.rpm.artifactName, "norc-1.140.0-1.aarch64.rpm");
  assert.equal((await readJson(path.join(output, "build/main/upstream.json"))).version, "1.140.0");
});
test("Linux reminders use non-focusable notification windows and default to top right", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const [platform, type, focusable, position] of [
    ["linux", "notification", false, "topRight"],
    ["darwin", "panel", true, "topRight"],
    ["win32", "panel", true, "bottomRight"],
  ]) {
    const context = vm.createContext({ process: { platform } });
    vm.runInContext(source, context);
    const options = vm.runInContext("reminderOptions()", context);
    assert.equal(options.type, type);
    assert.equal(options.focusable, focusable);
    assert.equal(options.alwaysOnTop, true);
    assert.equal(vm.runInContext("reminderPosition()", context), position);
    assert.equal(vm.runInContext('reminderPosition("topCenter")', context), "topCenter");
  }
});
test("reusing an older Norc extraction upgrades its reminder windows", async (t) => {
  const output = await fixture(t);
  await writeFile(path.join(output, "build/main/linux.js"), "// Previous Norc bridge");
  const main = path.join(output, "build/main/main.js");
  await writeFile(main, (await readFile(main, "utf8")).replace('title:`Cron`', 'title:`Norc`'));
  await patchApp({ output });
  const context = vm.createContext({ process: { platform: "linux" } });
  vm.runInContext(await readFile(main, "utf8"), context);
  assert.equal(vm.runInContext("reminderOptions().type", context), "notification");
  assert.equal(vm.runInContext("reminderFocusable()", context), false);
  assert.equal(vm.runInContext("reminderPosition()", context), "topRight");
});
test("an unexpected reminder layout fails before writing any changes", async (t) => {
  const output = await fixture(t);
  const main = path.join(output, "build/main/main.js");
  await writeFile(main, (await readFile(main, "utf8")).replace('type:`panel`', 'type:`changed`'));
  const before = await snapshot(output);
  await assert.rejects(patchApp({ output }), /reminder window type changed/);
  assert.deepEqual(await snapshot(output), before);
});
test("an unexpected upstream layout fails before writing any changes", async (t) => {
  const output = await fixture(t);
  await writeFile(path.join(output, "build/preload/preload-bundle.js"), "const changed=true;");
  const before = await snapshot(output);
  await assert.rejects(patchApp({ output }), /window controls changed/);
  assert.deepEqual(await snapshot(output), before);
});
test("extraction refuses to overwrite an existing app", async (t) => {
  const output = await fixture(t);
  const before = await snapshot(output);
  await assert.rejects(prepareApp({ output }), /already exists/);
  assert.deepEqual(await snapshot(output), before);
});
test("a release tag for another upstream version fails before patching or installing dependencies", async (t) => {
  const output = await fixture(t);
  const before = await snapshot(output);
  await assert.rejects(buildApp({
    output, targets: ["rpm"], arch: "x64", reuse: true, "release-tag": "v99.0.0",
  }), /must match upstream Notion Calendar version: v1\.139\.0/);
  assert.deepEqual(await snapshot(output), before);
});
test("embedded PNG icons are extracted unchanged and malformed ICNS is rejected", async (t) => {
  const output = await fixture(t);
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
  png.writeUInt32BE(512, 16); png.writeUInt32BE(512, 20);
  const icns = Buffer.alloc(16 + png.length);
  icns.write("icns"); icns.writeUInt32BE(icns.length, 4);
  icns.write("ic09", 8); icns.writeUInt32BE(8 + png.length, 12); png.copy(icns, 16);
  const source = path.join(output, "icon.icns");
  const destination = path.join(output, "icons");
  await writeFile(source, icns);
  await extractIcons(source, destination);
  assert.deepEqual(await readFile(path.join(destination, "512x512.png")), png);
  icns.writeUInt32BE(1, 12);
  await writeFile(source, icns);
  await assert.rejects(extractIcons(source, destination), /Invalid ICNS block/);
});
test("native artifact names include package revision, architecture and real compression format", () => {
  assert.deepEqual(artifactNames("1.0.0", "x64"), {
    deb: "norc_1.0.0-1_amd64.deb", rpm: "norc-1.0.0-1.x86_64.rpm", pacman: "norc-1.0.0-1-x86_64.pkg.tar.xz",
  });
  assert.equal(artifactNames("1.1.0-beta.1", "arm64").rpm, "norc-1.1.0~beta.1-1.aarch64.rpm");
  assert.throws(() => artifactNames("1.0.0", "unknown"), /Unsupported architecture/);
});
test("icon refresh removes stale Cron assets and records hashes for the upstream PNGs", async (t) => {
  const output = await fixture(t);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0", electronVersion: "41.5.0", dmgSha256: "a".repeat(64),
  });
  const source = path.join(output, "build/icons");
  const destination = path.join(output, "repository-icons");
  await mkdir(source); await mkdir(destination);
  await writeFile(path.join(destination, "icon_16x16.png"), "old Cron icon");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(512, 16); png.writeUInt32BE(512, 20);
  await writeFile(path.join(source, "512x512.png"), png);
  await syncIcons({ output, destination });
  assert.deepEqual(await readFile(path.join(destination, "icon_512x512.png")), png);
  assert.equal((await readdir(destination)).includes("icon_16x16.png"), false);
  const metadata = await readJson(path.join(destination, "upstream.json"));
  assert.equal(metadata.version, "1.139.0");
  assert.match(metadata.assets[0].sha256, /^[a-f0-9]{64}$/);
  const before = await snapshot(destination);
  await writeFile(path.join(source, "512x512.png"), "invalid icon");
  await assert.rejects(syncIcons({ output, destination }), /Invalid upstream PNG/);
  assert.deepEqual(await snapshot(destination), before);
});
