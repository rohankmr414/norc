import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import afterPack, { installLauncher, LAUNCHER } from "../scripts/launcher.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "norc launcher-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function runnableLauncher(t) {
  const directory = await fixture(t);
  const launcher = path.join(directory, "norc");
  await writeFile(launcher, LAUNCHER, { mode: 0o755 });
  await writeFile(
    path.join(directory, "norc-bin"),
    "#!/bin/sh\nexec node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- \"$@\"\n",
    { mode: 0o755 },
  );
  return { directory, launcher };
}

test("the Linux packaging hook keeps the ELF binary behind an executable launcher", async (t) => {
  const directory = await fixture(t);
  const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);
  await writeFile(path.join(directory, "norc"), binary, { mode: 0o755 });
  await afterPack({ appOutDir: directory, electronPlatformName: "linux" });
  assert.deepEqual(await readFile(path.join(directory, "norc-bin")), binary);
  assert.equal(await readFile(path.join(directory, "norc"), "utf8"), LAUNCHER);
  assert.equal((await stat(path.join(directory, "norc"))).mode & 0o777, 0o755);
});

test("unexpected packaging input fails without replacing either executable", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "norc"), "unexpected executable");
  await writeFile(path.join(directory, "norc-bin"), "original binary");
  await assert.rejects(installLauncher(directory), /Expected the Norc ELF executable/);
  assert.equal(await readFile(path.join(directory, "norc"), "utf8"), "unexpected executable");
  assert.equal(await readFile(path.join(directory, "norc-bin"), "utf8"), "original binary");
});

test("normal launch supplies X11 before Electron starts and preserves callback arguments", async (t) => {
  const { launcher } = await runnableLauncher(t);
  const args = ["--enable-logging", "cron://callback?code=a b&state=$value"];
  assert.deepEqual(JSON.parse(execFileSync(launcher, args, { encoding: "utf8" })), [
    "--ozone-platform=x11",
    ...args,
  ]);
});

test("explicit backend selections take precedence over the X11 default", async (t) => {
  const { launcher } = await runnableLauncher(t);
  for (const args of [
    ["--ozone-platform=wayland"],
    ["--ozone-platform=x11"],
    ["--ozone-platform=auto"],
    ["--enable-logging", "--ozone-platform=wayland", "cron://callback"],
    ["--ozone-platform", "wayland"],
  ]) {
    assert.deepEqual(JSON.parse(execFileSync(launcher, args, { encoding: "utf8" })), args);
  }
});

test("an installed command symlink resolves the binary beside the real launcher", async (t) => {
  const { launcher } = await runnableLauncher(t);
  const linkDirectory = await fixture(t);
  const link = path.join(linkDirectory, "norc");
  await symlink(launcher, link);
  assert.deepEqual(JSON.parse(execFileSync(link, ["cron://callback"], { encoding: "utf8" })), [
    "--ozone-platform=x11",
    "cron://callback",
  ]);
});

test("arguments after the option separator do not disable the default backend", async (t) => {
  const { launcher } = await runnableLauncher(t);
  const args = ["--", "--ozone-platform=wayland"];
  assert.deepEqual(JSON.parse(execFileSync(launcher, args, { encoding: "utf8" })), [
    "--ozone-platform=x11",
    ...args,
  ]);
});

test("the launcher returns the Electron process exit status", async (t) => {
  const { directory, launcher } = await runnableLauncher(t);
  await writeFile(path.join(directory, "norc-bin"), "#!/bin/sh\nexit 23\n", { mode: 0o755 });
  assert.throws(
    () => execFileSync(launcher),
    (error) => error.status === 23,
  );
});
