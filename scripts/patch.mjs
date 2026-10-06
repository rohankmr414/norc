import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ROOT, TARGETS, artifactNames, cli, exists, parseOptions, readJson, validateVersion, writeJson,
} from "./common.mjs";
import { prepareRpmScripts } from "./rpm.mjs";

function replaceOnce(source, pattern, replacement, description, appliedPattern) {
  const count = [...source.matchAll(pattern)].length;
  if (count === 0 && appliedPattern && [...source.matchAll(appliedPattern)].length === 1) return source;
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
  // Apply these independently so --reuse also upgrades previously patched apps.
  // macOS panels are ordinary windows on Linux. A non-focusable notification
  // avoids GNOME's focus-stealing protection and its "is ready" prompt.
  mainSource = replaceOnce(mainSource, /type:([`"'])panel\1,alwaysOnTop:!0/g,
    "type:process.platform===`linux`?`notification`:`panel`,alwaysOnTop:!0", "reminder window type",
    /type:process\.platform===`linux`\?`notification`:`panel`,alwaysOnTop:!0/g);
  mainSource = replaceOnce(mainSource, /return process\.platform===([`"'])darwin\1\?!([\w$]+):!0/g,
    "return process.platform===`linux`?!1:process.platform===`darwin`?!$2:!0", "reminder focus policy",
    /return process\.platform===`linux`\?!1:process\.platform===`darwin`\?![\w$]+:!0/g);
  mainSource = replaceOnce(mainSource, /\((?:process\.platform===`linux`\?`topLeft`:)?process\.platform===([`"'])darwin\1\?([`"'])topRight\2:([`"'])bottomRight\3\)/g,
    "(process.platform===`linux`?`topRight`:process.platform===`darwin`?`topRight`:`bottomRight`)", "reminder default corner",
    /\(process\.platform===`linux`\?`topRight`:process\.platform===`darwin`\?`topRight`:`bottomRight`\)/g);
  // Retain upstream's allowed schemes and macOS/Windows lookup paths.
  mainSource = replaceOnce(mainSource, /process\.platform===([`"'])win32\1\?([\w$]+)\(([\w$]+)\):!1:!1/g,
    "process.platform===`win32`?$2($3):process.platform===`linux`?require(`./protocol-handlers.js`).isProtocolRegistered($3):!1:!1", "protocol lookup",
    /process\.platform===`linux`\?require\(`\.\/protocol-handlers\.js`\)\.isProtocolRegistered\([\w$]+\):!1:!1/g);
  // Linux reads the hidden-start preference from the actual desktop entry.
  mainSource = replaceOnce(mainSource, /return ([\w$]+)\(\)\|\|\(([\w$]+)\.openAsHidden=([\w$]+)\.get\(([\w$]+)\)===!0\),\2/g,
    "return process.platform===`linux`||$1()||($2.openAsHidden=$3.get($4)===!0),$2", "login-item settings",
    /return process\.platform===`linux`\|\|[\w$]+\(\)\|\|\([\w$]+\.openAsHidden=[\w$]+\.get\([\w$]+\)===!0\),[\w$]+/g);
  // The login launch's explicit flag remains valid if settings change before
  // the renderer becomes ready; normal launches still show the calendar.
  mainSource = replaceOnce(mainSource, /([\w$]+)\(\)\.openAsHidden&&([\w$]+)\(\)&&!([\w$]+)/g,
    "(process.platform===`linux`?process.argv.includes(`--norc-start-hidden`):$1().openAsHidden)&&$2()&&!$3", "background autostart",
    /\(process\.platform===`linux`\?process\.argv\.includes\(`--norc-start-hidden`\):[\w$]+\(\)\.openAsHidden\)&&[\w$]+\(\)&&![\w$]+/g);
  // Quick Look is macOS-only. Linux renders diagnostic text in a read-only
  // window and avoids writing string attachments into the system temp folder.
  mainSource = replaceOnce(mainSource,
    /(function [\w$]+\(([\w$]+)\)\{)(?:if\(process\.platform===`linux`\)return require\(`\.\/file-preview\.js`\)\.previewFromString\([\w$]+,[\w$]+\);)?(if\(!([\w$]+)\)return;let [\w$]+=[\w$.]+\.app\.getPath\(([`"'])temp\5\)[^;]+;[\w$.]+\.writeFileSync\([\w$]+,\2\.content\),[\w$.]+\.existsSync\([\w$]+\)&&\4\.previewFile\([\w$]+,\2\.name\)\})/g,
    "$1if(process.platform===`linux`)return require(`./file-preview.js`).previewFromString($4,$2);$3", "feedback attachment preview");
  mainSource = replaceOnce(mainSource,
    /(function [\w$]+\(\{path:([\w$]+),name:([\w$]+)\}\)\{)(?:if\(process\.platform===`linux`\)return require\(`\.\/file-preview\.js`\)\.previewFromPath\([\w$]+,\{path:[\w$]+,name:[\w$]+\}\);)?([\w$]+)\?\.previewFile\(\2,\3\)\}/g,
    "$1if(process.platform===`linux`)return require(`./file-preview.js`).previewFromPath($4,{path:$2,name:$3});$4?.previewFile($2,$3)}", "file attachment preview");
  const rpmScripts = await prepareRpmScripts(output);
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
        mimeTypes: ["text/calendar", "text/x-vcalendar"],
        desktop: { entry: { Name: "Norc", Comment: "Unofficial Notion Calendar desktop app for Linux" } },
      },
      deb: { packageName: "norc", artifactName: names.deb },
      rpm: { packageName: "norc", artifactName: names.rpm, ...rpmScripts },
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
  await copyFile(path.join(ROOT, "system-settings.js"), path.join(output, "build/main/system-settings.js"));
  for (const filename of ["autostart.js", "desktop-entry.js", "protocol-handlers.js", "calendar-files.js", "file-preview.js", "update-links.js"]) {
    await copyFile(path.join(ROOT, filename), path.join(output, "build/main", filename));
  }
  await writeJson(manifest, data);
  console.info(`Configured Norc ${version} with Notion Calendar ${upstream.version} for ${arch}`);
}
cli(import.meta.url, async () => {
  const options = parseOptions();
  if (options.help) console.info("npm run patch -- [--output DIRECTORY] [--arch x64|arm64]");
  else await patchApp(options);
});
