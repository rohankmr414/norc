const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function xdgHome(env, variable, fallback) {
  return env[variable] && path.isAbsolute(env[variable])
    ? env[variable]
    : path.join(os.homedir(), fallback);
}

function xdgDirectories(env, variable, fallback) {
  return (env[variable] || fallback).split(":").filter((directory) => path.isAbsolute(directory));
}

function readDesktopEntry(filename) {
  let source;
  try {
    source = fs.readFileSync(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const entry = {};
  let inEntry = false;
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inEntry || line.startsWith("#")) continue;
    const match = /^([^=\s]+)\s*=(.*)$/.exec(line);
    if (match)
      entry[match[1]] = match[2].replace(
        /\\([sntr\\])/g,
        (_match, character) =>
          ({
            s: " ",
            n: "\n",
            t: "\t",
            r: "\r",
            "\\": "\\",
          })[character],
      );
  }
  return entry;
}

function quoteExecArgument(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Invalid desktop command argument");
  // Desktop values are unescaped before Exec arguments are parsed. Backslashes
  // therefore need four copies; the other reserved characters need two.
  return `"${value
    .replace(/\\/g, "\\\\\\\\")
    .replace(/["`$]/g, (character) => `\\\\${character}`)
    .replace(/%/g, "%%")}"`;
}

function escapeDesktopValue(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Invalid desktop entry value");
  return value.replace(/\\/g, "\\\\").replace(/\t/g, "\\t");
}

function execProgram(command) {
  if (!command) return null;
  let program = "",
    quoted = false,
    escaped = false;
  for (const character of command.trimStart()) {
    if (escaped) {
      program += character;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (/\s/.test(character) && !quoted) break;
    else program += character;
  }
  return program && !quoted && !escaped ? program.replace(/%%/g, "%") : null;
}

function executableExists(program, env) {
  if (!program || /[\0\r\n]/.test(program)) return false;
  const candidates = path.isAbsolute(program)
    ? [program]
    : program.includes("/")
      ? []
      : (env.PATH ?? "/usr/local/bin:/usr/bin:/bin")
          .split(":")
          .filter(Boolean)
          .map((directory) => path.join(directory, program));
  return candidates.some((filename) => {
    try {
      fs.accessSync(filename, fs.constants.X_OK);
      return fs.statSync(filename).isFile();
    } catch {
      return false;
    }
  });
}

function findDesktopEntry(id, env) {
  if (typeof id !== "string" || !id.endsWith(".desktop") || /[/\\\0\r\n]/.test(id)) return null;
  const directories = [
    xdgHome(env, "XDG_DATA_HOME", ".local/share"),
    ...xdgDirectories(env, "XDG_DATA_DIRS", "/usr/local/share:/usr/share"),
  ];
  function find(directory, prefix = "") {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      const entryId = prefix + entry.name;
      if (entryId === id && !entry.isDirectory()) return filename;
      // Desktop file IDs replace subdirectory separators with hyphens.
      if (entry.isDirectory() && id.startsWith(entryId + "-")) {
        const result = find(filename, entryId + "-");
        if (result) return result;
      }
    }
    return null;
  }
  for (const directory of directories) {
    const applications = path.join(directory, "applications");
    const direct = path.join(applications, id);
    if (fs.existsSync(direct)) return direct;
    const nested = find(applications);
    if (nested) return nested;
  }
  return null;
}

module.exports = {
  xdgHome,
  xdgDirectories,
  readDesktopEntry,
  quoteExecArgument,
  escapeDesktopValue,
  execProgram,
  executableExists,
  findDesktopEntry,
};
