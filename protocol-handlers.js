const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { findDesktopEntry, readDesktopEntry, execProgram, executableExists } = require("./desktop-entry.js");
const execFileAsync = promisify(execFile);

async function readCommand(command, args, env) {
  const { stdout } = await execFileAsync(command, args, { env, encoding: "utf8", timeout: 2000, maxBuffer: 16384 });
  return stdout.trim();
}

function usableHandler(id, env) {
  const filename = findDesktopEntry(id, env);
  if (!filename) return false;
  const entry = readDesktopEntry(filename);
  if (!entry || entry.Type !== "Application" || entry.Hidden === "true") return false;
  if (entry.TryExec && !executableExists(entry.TryExec, env)) return false;
  if (!entry.Exec) return entry.DBusActivatable === "true";
  return executableExists(execProgram(entry.Exec), env);
}

async function isProtocolRegistered(protocol, { env = process.env, read = readCommand } = {}) {
  if (typeof protocol !== "string") return false;
  const scheme = protocol.replace(/:$/, "").toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return false;
  const mimeType = `x-scheme-handler/${scheme}`;
  try {
    const handler = (await read("xdg-mime", ["query", "default", mimeType], env)).trim();
    if (usableHandler(handler, env)) return true;
  } catch {}
  // GIO is a fallback for desktops without xdg-utils. Keep its output language
  // predictable without changing the application's environment or associations.
  try {
    const output = await read("gio", ["mime", mimeType], { ...env, LC_ALL: "C" });
    const handler = /^Default application for .+: (.+\.desktop)\s*$/m.exec(output)?.[1];
    if (handler && usableHandler(handler, env)) return true;
  } catch {}
  return false;
}

module.exports = { isProtocolRegistered };
