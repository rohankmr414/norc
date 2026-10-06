const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

// Linux has no standard API for opening a particular system settings panel.
// Select the session's own tools rather than whichever desktop is installed first.
const desktops = [
  {
    id: "X-Cinnamon",
    names: ["cinnamon"],
    notifications: [["cinnamon-settings", "notifications"]],
    general: [["cinnamon-settings"]],
  },
  {
    id: "Budgie",
    names: ["budgie"],
    notifications: [
      ["budgie-control-center", "notifications"],
      ["gnome-control-center", "notifications"],
    ],
    general: [["budgie-control-center"], ["gnome-control-center"]],
  },
  {
    id: "KDE",
    names: ["kde", "plasma", "plasmawayland", "plasmax11"],
    notifications: [
      ["systemsettings", "kcm_notifications"],
      ["kcmshell6", "kcm_notifications"],
      ["systemsettings5", "kcm_notifications"],
      ["kcmshell5", "kcm_notifications"],
    ],
    general: [["systemsettings"], ["systemsettings5"]],
  },
  {
    id: "XFCE",
    names: ["xfce"],
    notifications: [["xfce4-notifyd-config"]],
    general: [["xfce4-settings-manager"]],
  },
  {
    id: "MATE",
    names: ["mate"],
    notifications: [["mate-notification-properties"]],
    general: [["mate-control-center"]],
  },
  {
    id: "LXQt",
    names: ["lxqt"],
    notifications: [["lxqt-config-notificationd"]],
    general: [["lxqt-config"]],
  },
  {
    id: "GNOME",
    names: ["gnome", "ubuntu"],
    notifications: [["gnome-control-center", "notifications"]],
    general: [["gnome-control-center"]],
  },
];

function desktopFor(identifier) {
  const value = identifier.toLowerCase();
  return desktops.find(({ names }) =>
    names.some((name) => new RegExp(`(^|[^a-z])${name}($|[^a-z])`).test(value)),
  );
}

async function readCommand(command, args, env) {
  const { stdout } = await execFileAsync(command, args, {
    env,
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 8192,
  });
  return stdout.trim();
}

function launchCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: true, stdio: "ignore", shell: false });
    let timer;
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code}`));
    });
    // A settings app can run until its window closes. Catch immediate failures
    // without making the button wait for the whole application lifetime.
    child.once("spawn", () => {
      timer = setTimeout(resolve, 250);
    });
    child.unref();
  });
}

async function openSystemSettings(
  pane,
  { env = process.env, launch = launchCommand, read = readCommand } = {},
) {
  const notifications = pane === "notifications";
  const identifiers = `${env.XDG_CURRENT_DESKTOP || ""}:${env.DESKTOP_SESSION || ""}`.split(":");
  let desktop = identifiers.map(desktopFor).find(Boolean);
  if (!desktop) {
    // Launchers sometimes omit desktop variables. Query the standard notification
    // service before choosing a settings app from a potentially different desktop.
    try {
      const server = await read(
        "gdbus",
        [
          "call",
          "--session",
          "--dest",
          "org.freedesktop.Notifications",
          "--object-path",
          "/org/freedesktop/Notifications",
          "--method",
          "org.freedesktop.Notifications.GetServerInformation",
        ],
        env,
      );
      desktop = desktopFor(server);
    } catch {}
  }
  const launchEnv =
    desktop && !env.XDG_CURRENT_DESKTOP ? { ...env, XDG_CURRENT_DESKTOP: desktop.id } : env;
  const commands = desktop
    ? [...(notifications ? desktop.notifications : []), ...desktop.general]
    : [];
  for (const [command, ...args] of commands) {
    try {
      await launch(command, args, launchEnv);
      return;
    } catch {}
  }
  // Some desktops register a settings URI (for example, elementary OS).
  // Only use it when there is an actual handler, avoiding an application chooser.
  try {
    if (await read("xdg-mime", ["query", "default", "x-scheme-handler/settings"], launchEnv)) {
      await launch(
        "xdg-open",
        [notifications ? "settings://notifications" : "settings://"],
        launchEnv,
      );
      return;
    }
  } catch {}
  throw new Error("No compatible system settings application could be opened.");
}

module.exports = { openSystemSettings };
