import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT, TARGETS, artifactNames, cli, exists, parseOptions, readJson, validateVersion, writeJson,
} from "./common.mjs";

function replaceOnce(source, pattern, replacement, description) {
  const count = [...source.matchAll(pattern)].length;
  if (count !== 1) throw new Error(`Upstream ${description} changed: expected one match, found ${count}`);
  return source.replace(pattern, replacement);
}
export async function patchApp({ output, arch = "x64" }) {
  const manifest = path.join(output, "package.json");
  const data = await readJson(manifest);
  const upstream = await readJson(path.join(output, ".norc-upstream.json"));
  validateVersion(upstream.version);
  validateVersion(upstream.electronVersion);
  const version = upstream.version;
  const names = artifactNames(version, arch);
  const main = path.join(output, "build/main/main.js");
  const preload = path.join(output, "build/preload/preload-bundle.js");
  let mainSource = await readFile(main, "utf8");
  let preloadSource = await readFile(preload, "utf8");
  // Check all upstream patterns before making any changes.
  if (!await exists(path.join(output, "build/main/linux.js"))) {
    mainSource = replaceOnce(mainSource, /title:([`"'])Cron\1/g, "title:`Norc`", "window title");
    preloadSource = replaceOnce(preloadSource, /process\.platform===([`"'])win32\1/g,
      "(process.platform===`win32`||process.platform===`linux`)", "window controls");
    preloadSource = replaceOnce(preloadSource, /usesNativeMacOsTrafficLight:!0/g,
      "usesNativeMacOsTrafficLight:!1", "traffic-light configuration");
  }
  Object.assign(data, {
    name: "norc", productName: "Norc", desktopName: "norc.desktop", version,
    description: "Unofficial Notion Calendar desktop app for Linux",
    homepage: "https://github.com/rohankmr414/norc",
    author: { name: "Norc contributors", email: "rohankmr414@users.noreply.github.com" },
    license: "UNLICENSED", main: "./build/main/linux.js",
    devDependencies: { electron: upstream.electronVersion },
    scripts: { start: "electron --ozone-platform=x11 ." },
    build: {
      appId: "com.cron.electron", electronVersion: upstream.electronVersion, productName: "Norc", buildNumber: "1",
      linux: {
        target: TARGETS, category: "Office;Calendar", executableName: "norc",
        icon: "build/icons", syncDesktopName: true,
        desktop: { entry: { Name: "Norc", Comment: "Unofficial Notion Calendar desktop app for Linux" } },
      },
      deb: { packageName: "norc", artifactName: names.deb },
      rpm: { packageName: "norc", artifactName: names.rpm },
      pacman: { packageName: "norc", artifactName: names.pacman, compression: "xz" },
      // The official OAuth callback protocol is still cron://.
      protocols: [{ name: "Notion Calendar", schemes: ["cron"] }],
      directories: { output: "release" }, files: ["build/**/*", "assets/**/*"],
    },
  });
  delete data.packageManager;
  delete data.config;
  await writeFile(main, mainSource);
  await writeFile(preload, preloadSource);
  await writeJson(path.join(output, "build/main/upstream.json"), upstream);
  await copyFile(path.join(ROOT, "linux.js"), path.join(output, "build/main/linux.js"));
  await writeJson(manifest, data);
  console.info(`Configured Norc ${version} with Notion Calendar ${upstream.version} for ${arch}`);
}
cli(import.meta.url, async () => {
  const options = parseOptions();
  if (options.help) console.info("npm run patch -- [--output DIRECTORY] [--arch x64|arm64]");
  else await patchApp(options);
});
