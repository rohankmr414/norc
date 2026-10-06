const fs = require("node:fs");
const path = require("node:path");
const {
  xdgHome,
  xdgDirectories,
  readDesktopEntry,
  quoteExecArgument,
  escapeDesktopValue,
  execProgram,
  executableExists,
} = require("./desktop-entry.js");

function createAutostart({ command, env = process.env, argv = process.argv }) {
  const directory = path.join(xdgHome(env, "XDG_CONFIG_HOME", ".config"), "autostart");
  const filename = path.join(directory, "norc.desktop");
  const systemFiles = xdgDirectories(env, "XDG_CONFIG_DIRS", "/etc/xdg").map((directory) =>
    path.join(directory, "autostart/norc.desktop"),
  );
  function getLoginItemSettings() {
    let entry;
    for (const file of [filename, ...systemFiles]) {
      try {
        entry = readDesktopEntry(file);
      } catch {
        break;
      }
      if (entry !== null) break;
    }
    const desktop = (env.XDG_CURRENT_DESKTOP || "").split(":");
    const matches = (list) =>
      list
        .split(";")
        .filter(Boolean)
        .some((name) => desktop.includes(name));
    const openAtLogin =
      !!entry &&
      !!entry.Exec &&
      entry.Type === "Application" &&
      entry.Hidden !== "true" &&
      entry["X-GNOME-Autostart-enabled"] !== "false" &&
      (!entry.OnlyShowIn || matches(entry.OnlyShowIn)) &&
      (!entry.NotShowIn || !matches(entry.NotShowIn)) &&
      executableExists(entry.TryExec || execProgram(entry.Exec), env);
    return {
      openAtLogin,
      openAsHidden: openAtLogin && entry["X-Norc-StartHidden"] === "true",
      wasOpenedAtLogin: argv.includes("--from-login"),
    };
  }
  function setLoginItemSettings({ openAtLogin = false, openAsHidden = false } = {}) {
    if (!openAtLogin && !systemFiles.some((file) => fs.existsSync(file))) {
      // Only remove Norc's own entry; other startup applications are untouched.
      fs.rmSync(filename, { force: true });
      return;
    }
    // GIO checks the first Exec program before expanding %% to a literal %.
    // Use env only for such paths, and TryExec still validates Norc itself.
    const launchCommand = command[0].includes("%") ? ["env", "--", ...command] : command;
    const exec = [
      ...launchCommand,
      "--from-login",
      ...(openAsHidden ? ["--norc-start-hidden"] : []),
    ]
      .map(quoteExecArgument)
      .join(" ");
    const tryExec = escapeDesktopValue(command[0]);
    fs.mkdirSync(directory, { recursive: true });
    const content = `[Desktop Entry]\nType=Application\nName=Norc\nExec=${exec}\nTryExec=${tryExec}\nIcon=norc\nTerminal=false\nHidden=${!openAtLogin}\nX-Norc-StartHidden=${!!openAsHidden}\n`;
    // Replacing the entry avoids truncating it if a write fails part-way through.
    const temporary = `${filename}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { mode: 0o600 });
      fs.renameSync(temporary, filename);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return { getLoginItemSettings, setLoginItemSettings };
}

module.exports = { createAutostart };
