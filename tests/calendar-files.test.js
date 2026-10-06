const assert = require("node:assert/strict");
const { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { calendarFileArguments, readCalendarFile } = require("../calendar-files.js");

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "norc-calendar-files-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("calendar arguments resolve local paths and file URLs against the launch directory", () => {
  assert.deepEqual(
    calendarFileArguments(
      [
        "norc",
        "event.ics",
        "nested/calendar.vcs",
        "/absolute/event.ICS",
        "file:///launch/a%20b%23%E2%9C%93.vcs",
        "file://localhost/launch/local.ics",
      ],
      "/launch",
    ),
    [
      "/launch/event.ics",
      "/launch/nested/calendar.vcs",
      "/absolute/event.ICS",
      "/launch/a b#✓.vcs",
      "/launch/local.ics",
    ],
  );
});

test("calendar argument parsing ignores unrelated URLs, options and malformed file URLs", () => {
  assert.deepEqual(
    calendarFileArguments(
      [
        "cron://auth/callback.ics",
        "https://example.com/event.ics",
        "--option=event.ics",
        "file://remote.example/event.ics",
        "file:///event%2Fname.ics",
        "file:///event%00.ics",
        "file:///event.ics?download=yes",
        "file:///event.vcs#fragment",
        "file:///broken%ZZ.ics",
        "document.txt",
        "",
        null,
        "/event\0.ics",
      ],
      "/launch",
    ),
    [],
  );
  assert.deepEqual(calendarFileArguments(["--", "-event.ics"], "/launch"), ["/launch/-event.ics"]);
});

test("equivalent path and URL arguments are deduplicated within one launch", () => {
  assert.deepEqual(
    calendarFileArguments(
      ["event.ics", "./event.ics", "nested/../event.ics", "file:///launch/event.ics", "other.vcs"],
      "/launch",
    ),
    ["/launch/event.ics", "/launch/other.vcs"],
  );
});

test("calendar reads preserve Unicode and line endings and support uppercase extensions", async (t) => {
  const directory = await fixture(t);
  const filename = path.join(directory, "Meeting #✓.ICS");
  const contents =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Lunch ☕\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  await writeFile(filename, contents);
  const files = calendarFileArguments([pathToFileURL(filename).href], "/launch");
  assert.deepEqual(files, [filename]);
  assert.deepEqual(await readCalendarFile(files[0]), {
    path: path.join(directory, "Meeting #✓.ics"),
    contents,
  });
  assert.equal(await readFile(filename, "utf8"), contents);
});

test("calendar reads follow a file-manager symlink without treating directories as files", async (t) => {
  const directory = await fixture(t);
  const original = path.join(directory, "calendar.vcs");
  const link = path.join(directory, "linked.vcs");
  await writeFile(original, "BEGIN:VCALENDAR\nVERSION:1.0\nEND:VCALENDAR\n");
  await symlink(original, link);
  assert.equal((await readCalendarFile(link)).path, link);
  const folder = path.join(directory, "folder.ics");
  await mkdir(folder);
  await assert.rejects(readCalendarFile(folder), /Not a regular calendar file/);
  await assert.rejects(readCalendarFile(path.join(directory, "missing.ics")), { code: "ENOENT" });
});

test("unreadable calendar files fail without changing their permissions", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("root can read mode-000 files");
    return;
  }
  const directory = await fixture(t);
  const filename = path.join(directory, "private.ics");
  await writeFile(filename, "calendar contents");
  await chmod(filename, 0o000);
  try {
    await assert.rejects(readCalendarFile(filename), { code: "EACCES" });
  } finally {
    await chmod(filename, 0o600);
  }
});
