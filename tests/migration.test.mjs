import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const reminderSource =
  "const fullScreen=false;function reminderOptions(){return {type:`panel`,alwaysOnTop:!0,focusable:reminderFocusable()}}function reminderFocusable(){return process.platform===`darwin`?!fullScreen:!0}function reminderPosition(position){return position??(process.platform===`darwin`?`topRight`:`bottomRight`)}";
const integrationSource =
  "function allowed(e){return [`notion`,`zoommtg`].includes(e)}async function macHandler(e){return `mac:${e}`}async function windowsHandler(e){return `windows:${e}`}async function protocolRegistered(e){return allowed(e)?process.platform===`darwin`?macHandler(e):process.platform===`win32`?windowsHandler(e):!1:!1}function launchedAtLogin(){return process.argv.includes(`--from-login`)}const startupHandled=false;function startupHidden(){return loginSettings().openAsHidden&&launchedAtLogin()&&!startupHandled}";
const loginSources = {
  legacy:
    "function legacyLogin(){return !1}function loginSettings(){let settings=loginApp.getLoginItemSettings();return legacyLogin()||(settings.openAsHidden=preferences.get(hiddenKey)===!0),settings}",
  // Notion Calendar 1.142.0: spread-based getter and a setter without openAsHidden.
  current:
    "const startArgs=`--process-start-args`,loginFlag=`--from-login`;function loginSettings(){return{...loginApp.getLoginItemSettings({args:[startArgs,loginFlag]}),openAsHidden:preferences.get(hiddenKey)===!0}}function setLoginSettings({openAtLogin:n,openAsHidden:r}){let i=loginSettings();(i.openAtLogin!==n||i.openAsHidden!==r)&&(loginApp.setLoginItemSettings({openAtLogin:n,args:[startArgs,loginFlag]}),preferences.set(hiddenKey,r),preferences.set(configuredKey,!0))}",
};
const previewSource =
  "function previewString(e){if(!previewParent)return;let t=previewElectron.app.getPath(`temp`),n=previewPathLib.resolve(t,`attachment.json`);previewFs.writeFileSync(n,e.content),previewFs.existsSync(n)&&previewParent.previewFile(n,e.name)}function previewPath({path:e,name:t}){previewParent?.previewFile(e,t)}";

async function fixture(t, loginSource = loginSources.legacy) {
  const output = await mkdtemp(path.join(os.tmpdir(), "norc-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await mkdir(path.join(output, "build/main"), { recursive: true });
  await mkdir(path.join(output, "build/preload"), { recursive: true });
  await writeJson(path.join(output, "package.json"), {
    name: "notion-calendar-web",
    version: "1.139.0",
    dependencies: { "electron-store": "5.2.0" },
    packageManager: "pnpm@11.5.2",
    config: { forge: {} },
  });
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0",
    electronVersion: "41.5.0",
  });
  await writeFile(
    path.join(output, "build/main/main.js"),
    "const options={title:`Cron`};process.platform===`darwin`;process.platform===`win32`;" +
      reminderSource +
      integrationSource +
      loginSource +
      previewSource,
  );
  await writeFile(
    path.join(output, "build/preload/preload-bundle.js"),
    "const windows=process.platform===`win32`;const api={usesNativeMacOsTrafficLight:!0};",
  );
  return output;
}
async function snapshot(directory) {
  const files = {};
  for (const filename of (await readdir(directory, { recursive: true })).sort()) {
    try {
      files[filename] = await readFile(path.join(directory, filename), "utf8");
    } catch (error) {
      if (error.code !== "EISDIR") throw error;
    }
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
  assert.deepEqual(data.build.rpm.fpm, [
    "--rpm-posttrans",
    path.join(output, ".norc-rpm/post-transaction.sh"),
  ]);
  assert.equal(data.build.deb.afterRemove, undefined);
  assert.equal(data.build.pacman.afterRemove, undefined);
  assert.equal(data.build.pacman.artifactName, "norc-1.139.0-1-x86_64.pkg.tar.xz");
  assert.equal(data.packageManager, undefined);
  assert.equal(data.config, undefined);
  assert.equal((await readJson(path.join(output, "build/main/upstream.json"))).version, "1.139.0");
  assert.match(
    await readFile(path.join(output, "build/main/main.js"), "utf8"),
    /title:`Norc`.*platform===`darwin`/,
  );
  assert.match(
    await readFile(path.join(output, "build/preload/preload-bundle.js"), "utf8"),
    /platform===`linux`/,
  );
  for (const filename of [
    "autostart.js",
    "desktop-entry.js",
    "protocol-handlers.js",
    "calendar-files.js",
    "file-preview.js",
    "update-links.js",
  ]) {
    assert.equal(
      await readFile(path.join(output, "build/main", filename), "utf8"),
      await readFile(new URL(`../${filename}`, import.meta.url), "utf8"),
    );
  }
});
test("upstream catalog references resolve for npm without changing explicit dependency versions", async (t) => {
  const output = await fixture(t);
  const manifest = path.join(output, "package.json");
  const data = await readJson(manifest);
  data.dependencies["electron-context-menu"] = "catalog:";
  data.optionalDependencies = { example: "catalog:default" };
  data.peerDependencies = { other: "catalog:compat" };
  // Upstream development dependencies are replaced by the matching Electron.
  data.devDependencies = { unused: "catalog:missing" };
  await writeJson(manifest, data);
  const workspace = path.join(output, "pnpm-workspace.yaml");
  await writeFile(
    workspace,
    "catalog:\n  electron-context-menu: 5.1.0\n  electron-store: 99.0.0\n  example: ^2.0.0\ncatalogs:\n  compat:\n    other: ~3.0.0\n",
  );
  await patchApp({ output });
  const patched = await readJson(manifest);
  assert.deepEqual(patched.dependencies, {
    "electron-store": "5.2.0",
    "electron-context-menu": "5.1.0",
  });
  assert.deepEqual(patched.optionalDependencies, { example: "^2.0.0" });
  assert.deepEqual(patched.peerDependencies, { other: "~3.0.0" });
  assert.deepEqual(patched.devDependencies, { electron: "41.5.0" });
  // Reusing a resolved extraction no longer needs its workspace catalog.
  await rm(workspace);
  const first = await snapshot(output);
  await patchApp({ output });
  assert.deepEqual(await snapshot(output), first);
});
test("invalid upstream catalogs fail before modifying the extraction", async (t) => {
  for (const [workspace, error] of [
    [null, /pnpm-workspace\.yaml/],
    ["catalog: {}\n", /Invalid upstream catalog version/],
    ["catalog:\n  electron-context-menu: 5\n", /Invalid upstream catalog version/],
    ['catalog:\n  electron-context-menu: "catalog:"\n', /Invalid upstream catalog version/],
    ["catalog: [\n", /unexpected end/],
  ]) {
    const output = await fixture(t);
    const manifest = path.join(output, "package.json");
    const data = await readJson(manifest);
    data.dependencies["electron-context-menu"] = "catalog:";
    await writeJson(manifest, data);
    if (workspace !== null) await writeFile(path.join(output, "pnpm-workspace.yaml"), workspace);
    const before = await snapshot(output);
    await assert.rejects(patchApp({ output }), error);
    assert.deepEqual(await snapshot(output), before);
  }
});
test("desktop integration advertises calendar files and retains OAuth URL arguments", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const data = await readJson(path.join(output, "package.json"));
  const helper = {
    packager: {
      appInfo: { productName: "Norc", sanitizedProductName: "Norc" },
      executableName: "norc",
      info: { metadata: data },
      config: data.build,
      platformSpecificBuildOptions: data.build.linux,
      fileAssociations: [],
    },
    getDescription: () => data.description,
  };
  const desktop = await LinuxTargetHelper.prototype.computeDesktopEntry.call(
    helper,
    data.build.linux,
  );
  assert.match(desktop, /^Exec=\/opt\/Norc\/norc %U$/m);
  assert.match(desktop, /^MimeType=text\/calendar;text\/x-vcalendar;x-scheme-handler\/cron;$/m);
});
test("protocol patch uses Linux lookup while preserving the allowlist and upstream platforms", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const [platform, expected] of [
    ["linux", "linux:notion"],
    ["darwin", "mac:notion"],
    ["win32", "windows:notion"],
  ]) {
    const calls = [];
    const context = vm.createContext({
      process: { platform },
      require: (filename) => {
        assert.equal(filename, "./protocol-handlers.js");
        return {
          isProtocolRegistered: async (scheme) => {
            calls.push(scheme);
            return `linux:${scheme}`;
          },
        };
      },
    });
    vm.runInContext(source, context);
    assert.equal(await vm.runInContext('protocolRegistered("notion")', context), expected);
    assert.equal(await vm.runInContext('protocolRegistered("javascript")', context), false);
    assert.deepEqual(calls, platform === "linux" ? ["notion"] : []);
  }
});
test("attachment previews use the Linux viewer and preserve the upstream preview on other platforms", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const platform of ["linux", "darwin", "win32"]) {
    const previews = [],
      nativePreviews = [],
      writes = [];
    const parent = { previewFile: (...args) => nativePreviews.push(args) };
    const context = vm.createContext({
      process: { platform },
      previewParent: parent,
      previewPathLib: path,
      previewElectron: { app: { getPath: () => "/tmp" } },
      previewFs: { writeFileSync: (...args) => writes.push(args), existsSync: () => true },
      require: (filename) => {
        assert.equal(filename, "./file-preview.js");
        return {
          previewFromString: (owner, attachment) => {
            assert.equal(owner, parent);
            previews.push(["string", { ...attachment }]);
          },
          previewFromPath: (owner, attachment) => {
            assert.equal(owner, parent);
            previews.push(["path", { ...attachment }]);
          },
        };
      },
    });
    vm.runInContext(source, context);
    await vm.runInContext(
      'previewString({name:"debug.json",content:"{}",contentType:"application/json"})',
      context,
    );
    await vm.runInContext(
      'previewPath({path:"/existing/debug.json",name:"Existing diagnostic"})',
      context,
    );
    assert.deepEqual(
      previews,
      platform === "linux"
        ? [
            ["string", { name: "debug.json", content: "{}", contentType: "application/json" }],
            ["path", { path: "/existing/debug.json", name: "Existing diagnostic" }],
          ]
        : [],
    );
    assert.deepEqual(writes, platform === "linux" ? [] : [["/tmp/attachment.json", "{}"]]);
    assert.deepEqual(
      nativePreviews,
      platform === "linux"
        ? []
        : [
            ["/tmp/attachment.json", "debug.json"],
            ["/existing/debug.json", "Existing diagnostic"],
          ],
    );
  }
});
test("changed attachment preview hooks fail before modifying the extraction", async (t) => {
  for (const [original, changed, error] of [
    [
      "writeFileSync(n,e.content)",
      "writeFileSync(n,e.data)",
      /feedback attachment preview changed/,
    ],
    [
      "previewParent?.previewFile(e,t)",
      "previewParent?.previewFile(e)",
      /file attachment preview changed/,
    ],
  ]) {
    const output = await fixture(t);
    const main = path.join(output, "build/main/main.js");
    await writeFile(main, (await readFile(main, "utf8")).replace(original, changed));
    const before = await snapshot(output);
    await assert.rejects(patchApp({ output }), error);
    assert.deepEqual(await snapshot(output), before);
  }
});
for (const [layout, loginSource] of Object.entries(loginSources)) {
  test(`${layout} login settings preserve Linux's actual hidden preference and upstream behavior elsewhere`, async (t) => {
    const output = await fixture(t, loginSource);
    await patchApp({ output });
    const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
    for (const platform of ["linux", "darwin", "win32"]) {
      for (const hidden of [false, true]) {
        const calls = [];
        const context = vm.createContext({
          process: { platform },
          hiddenKey: "hidden",
          preferences: { get: () => !hidden },
          loginApp: {
            getLoginItemSettings: (options) => {
              calls.push(options);
              return { openAtLogin: true, openAsHidden: hidden, wasOpenedAtLogin: true };
            },
          },
        });
        vm.runInContext(source, context);
        const settings = vm.runInContext("loginSettings()", context);
        assert.equal(settings.openAsHidden, platform === "linux" ? hidden : !hidden);
        assert.equal(settings.openAtLogin, true);
        assert.equal(settings.wasOpenedAtLogin, true);
        assert.equal(calls.length, 1);
        if (layout === "current") {
          assert.deepEqual(Array.from(calls[0].args), ["--process-start-args", "--from-login"]);
        }
      }
    }
    const first = await snapshot(output);
    await patchApp({ output });
    assert.deepEqual(await snapshot(output), first);
  });
  test(`${layout} background startup follows launch flags without hiding normal or visible login launches`, async (t) => {
    const output = await fixture(t, loginSource);
    await patchApp({ output });
    const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
    for (const [argv, expected] of [
      [["norc"], false],
      [["norc", "--from-login"], false],
      [["norc", "--norc-start-hidden"], false],
      [["norc", "--from-login", "--norc-start-hidden"], true],
    ]) {
      const context = vm.createContext({
        process: { platform: "linux", argv },
        loginApp: { getLoginItemSettings: () => ({ openAsHidden: false }) },
      });
      vm.runInContext(source, context);
      assert.equal(vm.runInContext("startupHidden()", context), expected);
    }
  });
}
test("current login setter forwards hidden startup to Linux and preserves other platforms' options", async (t) => {
  const output = await fixture(t, loginSources.current);
  await patchApp({ output });
  const source = await readFile(path.join(output, "build/main/main.js"), "utf8");
  for (const platform of ["linux", "darwin", "win32"]) {
    for (const hidden of [false, true]) {
      const calls = [];
      const preferences = new Map([["hidden", !hidden]]);
      const context = vm.createContext({
        process: { platform },
        hiddenKey: "hidden",
        configuredKey: "configured",
        preferences,
        loginApp: {
          getLoginItemSettings: () => ({ openAtLogin: true, openAsHidden: !hidden }),
          setLoginItemSettings: (options) => calls.push(JSON.parse(JSON.stringify(options))),
        },
      });
      vm.runInContext(source, context);
      // Changing only the hidden preference must update the desktop entry too.
      vm.runInContext(`setLoginSettings({openAtLogin:true,openAsHidden:${hidden}})`, context);
      assert.deepEqual(calls, [
        {
          openAtLogin: true,
          ...(platform === "linux" ? { openAsHidden: hidden } : {}),
          args: ["--process-start-args", "--from-login"],
        },
      ]);
      assert.equal(preferences.get("hidden"), hidden);
      assert.equal(preferences.get("configured"), true);
    }
  }
});
test("changed or duplicate login hooks fail before modifying the extraction", async (t) => {
  for (const [loginSource, error] of [
    [loginSources.legacy.replace("===!0", "===true"), /login-item settings changed/],
    [loginSources.current.replace("===!0", "===true"), /login-item settings changed/],
    [loginSources.current.replace("openAtLogin:n,args:", "args:"), /login-item setter changed/],
    [loginSources.current.repeat(2), /login-item settings changed.*found 2/],
  ]) {
    const output = await fixture(t, loginSource);
    const before = await snapshot(output);
    await assert.rejects(patchApp({ output }), error);
    assert.deepEqual(await snapshot(output), before);
  }
});
test("changed protocol lookup fails before modifying the extraction", async (t) => {
  const output = await fixture(t);
  const main = path.join(output, "build/main/main.js");
  await writeFile(
    main,
    (await readFile(main, "utf8")).replace(
      "windowsHandler(e):!1:!1",
      "windowsHandler(e):false:false",
    ),
  );
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
  await writeFile(
    main,
    (await readFile(main, "utf8")).replace(
      "process.platform===`linux`?`topRight`:",
      "process.platform===`linux`?`topLeft`:",
    ),
  );
  await patchApp({ output });
  assert.deepEqual(await snapshot(output), first);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.140.0",
    electronVersion: "41.5.0",
  });
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
  await writeFile(main, (await readFile(main, "utf8")).replace("title:`Cron`", "title:`Norc`"));
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
  await writeFile(main, (await readFile(main, "utf8")).replace("type:`panel`", "type:`changed`"));
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
  await assert.rejects(
    buildApp({
      output,
      targets: ["rpm"],
      arch: "x64",
      reuse: true,
      "release-tag": "v99.0.0",
    }),
    /must match upstream Notion Calendar version: v1\.139\.0/,
  );
  assert.deepEqual(await snapshot(output), before);
});
test("a conflicting package revision or upstream checksum fails before modifying the extraction", async (t) => {
  const output = await fixture(t);
  const before = await snapshot(output);
  await assert.rejects(
    buildApp({
      output,
      targets: ["rpm"],
      arch: "x64",
      reuse: true,
      revision: 3,
      "release-tag": "v1.139.0-linux.2",
    }),
    /package revision/,
  );
  await assert.rejects(
    buildApp({
      output,
      targets: ["rpm"],
      arch: "x64",
      reuse: true,
      "upstream-sha256": "a".repeat(64),
    }),
    /pinned release checksum/,
  );
  assert.deepEqual(await snapshot(output), before);
});
test("pinned DMG checksums are checked before invoking the archive extractor", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "norc-pinned-dmg-"));
  const previousPath = process.env.PATH;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  });
  const extractor = path.join(directory, "7zz");
  await writeFile(extractor, "#!/bin/sh\nexit 99\n");
  await chmod(extractor, 0o755);
  process.env.PATH = directory;
  const dmg = path.join(directory, "upstream.dmg");
  await writeFile(dmg, "unexpected archive contents");
  await assert.rejects(
    prepareApp({ output: path.join(directory, "output"), dmg, "upstream-sha256": "a".repeat(64) }),
    /pinned release checksum/,
  );
  assert.deepEqual((await readdir(directory)).sort(), ["7zz", "upstream.dmg"]);
});
test("package revisions reach each native package without changing the app or Electron version", async (t) => {
  const output = await fixture(t);
  await patchApp({ output, revision: 2 });
  const data = await readJson(path.join(output, "package.json"));
  assert.equal(data.version, "1.139.0");
  assert.equal(data.build.buildNumber, "2");
  assert.equal(data.build.electronVersion, "41.5.0");
  assert.equal(data.build.rpm.artifactName, "norc-1.139.0-2.x86_64.rpm");
  assert.equal(data.build.deb.artifactName, "norc_1.139.0-2_amd64.deb");
  assert.equal(data.build.pacman.artifactName, "norc-1.139.0-2-x86_64.pkg.tar.xz");
  assert.deepEqual(data.build.protocols[0].schemes, ["cron"]);
});
test("embedded PNG icons are extracted unchanged and malformed ICNS is rejected", async (t) => {
  const output = await fixture(t);
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(png);
  png.writeUInt32BE(512, 16);
  png.writeUInt32BE(512, 20);
  const icns = Buffer.alloc(16 + png.length);
  icns.write("icns");
  icns.writeUInt32BE(icns.length, 4);
  icns.write("ic09", 8);
  icns.writeUInt32BE(8 + png.length, 12);
  png.copy(icns, 16);
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
    deb: "norc_1.0.0-1_amd64.deb",
    rpm: "norc-1.0.0-1.x86_64.rpm",
    pacman: "norc-1.0.0-1-x86_64.pkg.tar.xz",
  });
  assert.equal(artifactNames("1.1.0-beta.1", "arm64").rpm, "norc-1.1.0~beta.1-1.aarch64.rpm");
  assert.throws(() => artifactNames("1.0.0", "unknown"), /Unsupported architecture/);
});
test("icon refresh removes stale Cron assets and records hashes for the upstream PNGs", async (t) => {
  const output = await fixture(t);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0",
    electronVersion: "41.5.0",
    dmgSha256: "a".repeat(64),
  });
  const source = path.join(output, "build/icons");
  const destination = path.join(output, "repository-icons");
  await mkdir(source);
  await mkdir(destination);
  await writeFile(path.join(destination, "icon_16x16.png"), "old Cron icon");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(512, 16);
  png.writeUInt32BE(512, 20);
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
