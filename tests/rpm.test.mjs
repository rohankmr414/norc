import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRpmScripts } from "../scripts/rpm.mjs";

// Exercise the generated shell scripts with real files and symlinks. Only the
// system integration tools are replaced; all paths stay inside the fixture.
async function fixture(t, { alternatives = true, alternativesFail = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "norc-rpm-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "tools",
    "usr/bin",
    "etc/alternatives",
    "etc/apparmor.d",
    "opt/Norc/resources",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, "opt/Norc/norc"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(path.join(root, "opt/Norc/chrome-sandbox"), "sandbox", { mode: 0o755 });
  await writeFile(path.join(root, "opt/Norc/resources/apparmor-profile"), "new profile");
  const mock = `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const root = process.env.NORC_RPM_TEST_ROOT;
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls"), JSON.stringify([command, ...args]) + "\\n");
if (command === "update-alternatives") {
  if (process.env.NORC_RPM_TEST_ALTERNATIVES_FAIL === "1") process.exit(1);
  const link = path.join(root, "usr/bin/norc"), alternative = path.join(root, "etc/alternatives/norc");
  fs.rmSync(link, { force: true }); fs.rmSync(alternative, { force: true });
  if (args[0] === "--install") { fs.symlinkSync(args[3], alternative); fs.symlinkSync(alternative, link); }
}
`;
  for (const command of [
    "unshare",
    "apparmor_status",
    "apparmor_parser",
    "update-mime-database",
    "update-desktop-database",
    ...(alternatives ? ["update-alternatives"] : []),
  ]) {
    await writeFile(path.join(root, "tools", command), mock, { mode: 0o755 });
  }
  for (const command of ["rm", "ln", "cp", "chmod", "readlink"]) {
    await symlink(`/usr/bin/${command}`, path.join(root, "tools", command));
  }
  const scripts = await prepareRpmScripts(root);
  async function localScript(filename) {
    let source = await readFile(filename, "utf8");
    for (const location of [
      "/usr/bin/norc",
      "/etc/alternatives/norc",
      "/etc/apparmor.d/norc",
      "/opt/Norc",
    ]) {
      source = source.replaceAll(location, path.join(root, location));
    }
    const local = `${filename}.test`;
    await writeFile(local, source);
    execFileSync("/bin/bash", ["-n", local]);
    return local;
  }
  const postTransaction = await localScript(scripts.fpm[1]);
  const afterRemove = await localScript(scripts.afterRemove);
  const env = {
    ...process.env,
    PATH: path.join(root, "tools"),
    NORC_RPM_TEST_ROOT: root,
    NORC_RPM_TEST_ALTERNATIVES_FAIL: alternativesFail ? "1" : "0",
  };
  const run = (filename, ...args) =>
    execFileSync("/bin/bash", [filename, ...args], { env, stdio: "pipe" });
  const calls = async () => {
    try {
      return (await readFile(path.join(root, "calls"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };
  return { root, postTransaction, afterRemove, run, calls };
}

async function assertInstalled(root) {
  assert.equal(
    await readlink(path.join(root, "usr/bin/norc")),
    path.join(root, "etc/alternatives/norc"),
  );
  assert.equal(
    await readlink(path.join(root, "etc/alternatives/norc")),
    path.join(root, "opt/Norc/norc"),
  );
  assert.equal(await readFile(path.join(root, "etc/apparmor.d/norc"), "utf8"), "new profile");
  assert.equal((await stat(path.join(root, "opt/Norc/chrome-sandbox"))).mode & 0o7777, 0o755);
}

test("RPM upgrade cleanup retains the command and AppArmor profile while another instance remains", async (t) => {
  const { root, postTransaction, afterRemove, run, calls } = await fixture(t);
  run(postTransaction, "1");
  const before = await calls();
  for (const count of ["1", "2", "", "invalid"]) run(afterRemove, count);
  await assertInstalled(root);
  assert.deepEqual(await calls(), before);
});

test("RPM post-transaction repair restores integration removed by legacy package cleanup", async (t) => {
  const { root, postTransaction, run, calls } = await fixture(t);
  run(postTransaction, "2");
  // The legacy postun removes both after the new package's post has run.
  await rm(path.join(root, "usr/bin/norc"));
  await rm(path.join(root, "etc/alternatives/norc"));
  await rm(path.join(root, "etc/apparmor.d/norc"));
  run(postTransaction, "2");
  await assertInstalled(root);
  run(postTransaction, "1");
  await assertInstalled(root);
  assert.equal(
    (await calls()).filter((call) => call[0] === "apparmor_parser" && call[1] === "--replace")
      .length,
    3,
  );
});

test("RPM final removal cleans the registered alternative and unloads AppArmor", async (t) => {
  const { root, postTransaction, afterRemove, run, calls } = await fixture(t);
  run(postTransaction, "1");
  run(afterRemove, "0");
  for (const filename of ["usr/bin/norc", "etc/alternatives/norc", "etc/apparmor.d/norc"]) {
    await assert.rejects(stat(path.join(root, filename)), { code: "ENOENT" });
  }
  const operations = await calls();
  assert.deepEqual(
    operations.find((call) => call[0] === "update-alternatives" && call[1] === "--remove"),
    ["update-alternatives", "--remove", "norc", path.join(root, "opt/Norc/norc")],
  );
  assert.ok(operations.some((call) => call[0] === "apparmor_parser" && call[1] === "--remove"));
});

test("RPM integration works without an alternatives utility", async (t) => {
  const { root, postTransaction, afterRemove, run } = await fixture(t, { alternatives: false });
  run(postTransaction, "1");
  assert.equal(await readlink(path.join(root, "usr/bin/norc")), path.join(root, "opt/Norc/norc"));
  run(afterRemove, "1");
  assert.equal(await readlink(path.join(root, "usr/bin/norc")), path.join(root, "opt/Norc/norc"));
  run(afterRemove, "0");
  await assert.rejects(stat(path.join(root, "usr/bin/norc")), { code: "ENOENT" });
});

test("RPM repair falls back to a direct link when alternative registration fails", async (t) => {
  const { root, postTransaction, run } = await fixture(t, { alternativesFail: true });
  run(postTransaction, "2");
  assert.equal(await readlink(path.join(root, "usr/bin/norc")), path.join(root, "opt/Norc/norc"));
});
