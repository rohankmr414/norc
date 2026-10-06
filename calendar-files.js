const { constants } = require("node:fs");
const { open } = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const extensions = new Set([".ics", ".vcs"]);

function calendarFileArguments(argv, workingDirectory) {
  const files = new Set();
  let positional = false;
  for (const argument of argv) {
    if (argument === "--") { positional = true; continue; }
    if (typeof argument !== "string" || !argument || argument.includes("\0")) continue;
    if (!positional && argument.startsWith("-")) continue;
    let filename = argument;
    if (/^file:/i.test(argument)) {
      try {
        const url = new URL(argument);
        if (url.search || url.hash) continue;
        // fileURLToPath rejects remote hosts and encoded path separators.
        filename = fileURLToPath(url);
      } catch { continue; }
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(argument)) {
      continue;
    }
    if (!filename.includes("\0") && extensions.has(path.extname(filename).toLowerCase())) {
      files.add(path.resolve(workingDirectory, filename));
    }
  }
  return [...files];
}

async function readCalendarFile(filename) {
  // Nonblocking open lets us reject FIFOs/devices without hanging the app.
  const file = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error("Not a regular calendar file");
    const contents = await file.readFile("utf8");
    // Upstream consumes this path only to check the .ics/.vcs suffix, and that
    // check is case-sensitive. Read the original file; normalize only its suffix.
    const extension = path.extname(filename);
    return { path: filename.slice(0, -extension.length) + extension.toLowerCase(), contents };
  } finally {
    await file.close();
  }
}

module.exports = { calendarFileArguments, readCalendarFile };
