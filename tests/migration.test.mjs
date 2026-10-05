import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../scripts/build.mjs";
import { artifactNames, readJson, writeJson } from "../scripts/common.mjs";
import { extractIcons, prepareApp } from "../scripts/extract.mjs";
import { patchApp } from "../scripts/patch.mjs";
import { syncIcons } from "../scripts/icons.mjs";

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
    'const options={title:`Cron`};process.platform===`darwin`;process.platform===`win32`;');
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
  assert.equal(data.build.rpm.artifactName, "norc-1.139.0-1.x86_64.rpm");
  assert.equal(data.build.pacman.artifactName, "norc-1.139.0-1-x86_64.pkg.tar.xz");
  assert.equal(data.packageManager, undefined);
  assert.equal(data.config, undefined);
  assert.equal((await readJson(path.join(output, "build/main/upstream.json"))).version, "1.139.0");
  assert.match(await readFile(path.join(output, "build/main/main.js"), "utf8"), /title:`Norc`.*platform===`darwin`/);
  assert.match(await readFile(path.join(output, "build/preload/preload-bundle.js"), "utf8"), /platform===`linux`/);
});
test("patching can be repeated or upgraded without losing the upstream version", async (t) => {
  const output = await fixture(t);
  await patchApp({ output });
  const first = await snapshot(output);
  await patchApp({ output });
  assert.deepEqual(await snapshot(output), first);
  await writeJson(path.join(output, ".norc-upstream.json"), { version: "1.140.0", electronVersion: "41.5.0" });
  await patchApp({ output, arch: "arm64" });
  const data = await readJson(path.join(output, "package.json"));
  assert.equal(data.version, "1.140.0");
  assert.equal(data.build.rpm.artifactName, "norc-1.140.0-1.aarch64.rpm");
  assert.equal((await readJson(path.join(output, "build/main/upstream.json"))).version, "1.140.0");
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
