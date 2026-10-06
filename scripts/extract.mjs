import { constants, createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractAll } from "@electron/asar";
import plist from "plist";
import {
  DOWNLOAD_URL,
  cli,
  exists,
  hashFile,
  parseOptions,
  readJson,
  run,
  validateVersion,
  writeJson,
} from "./common.mjs";

async function findSevenZip() {
  for (const name of ["7zz", "7z"]) {
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      const filename = path.join(directory, name);
      try {
        await access(filename, constants.X_OK);
        return filename;
      } catch (error) {
        if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
      }
    }
  }
  throw new Error("Install 7-Zip (7zz or 7z) with DMG/HFS support");
}
async function findBundles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await findBundles(filename)));
    else if (filename.endsWith(`${path.sep}Contents${path.sep}Resources${path.sep}app.asar`))
      results.push(filename);
  }
  return results;
}
export async function extractIcons(source, destination) {
  const data = await readFile(source);
  if (
    data.length < 8 ||
    data.toString("ascii", 0, 4) !== "icns" ||
    data.readUInt32BE(4) !== data.length
  ) {
    throw new Error(`Invalid ICNS file: ${source}`);
  }
  const images = new Map();
  for (let offset = 8; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error(`Invalid ICNS block: ${source}`);
    const length = data.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > data.length)
      throw new Error(`Invalid ICNS block: ${source}`);
    const image = data.subarray(offset + 8, offset + length);
    if (image.length >= 24 && image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      const width = image.readUInt32BE(16);
      if (width > 0 && width === image.readUInt32BE(20)) images.set(width, image);
    }
    offset += length;
  }
  if (!images.has(512)) throw new Error("The upstream icon does not contain a 512px PNG");
  await mkdir(destination, { recursive: true });
  for (const [size, image] of images)
    await writeFile(path.join(destination, `${size}x${size}.png`), image);
}
export async function prepareApp({
  output,
  dmg,
  url = DOWNLOAD_URL,
  "upstream-sha256": expectedHash,
}) {
  output = path.resolve(output);
  if (await exists(output))
    throw new Error(`${output} already exists; choose --output or build with --reuse`);
  const sevenZip = await findSevenZip();
  await mkdir(path.dirname(output), { recursive: true });
  const work = await mkdtemp(path.join(path.dirname(output), "norc-"));
  try {
    const archive = dmg ? path.resolve(dmg) : path.join(work, "notion-calendar.dmg");
    let resolvedUrl = null;
    if (!dmg) {
      console.info(`Downloading ${url}`);
      const response = await fetch(url, {
        headers: { "User-Agent": "Norc-build" },
        signal: AbortSignal.timeout(240000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Download failed: HTTP ${response.status}`);
      resolvedUrl = response.url;
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    }
    const dmgSha256 = await hashFile(archive);
    if (
      expectedHash !== undefined &&
      (!/^[a-f0-9]{64}$/.test(expectedHash) || dmgSha256 !== expectedHash)
    ) {
      throw new Error("Downloaded upstream DMG does not match the pinned release checksum");
    }
    const resources = path.join(work, "resources");
    await run(sevenZip, [
      "x",
      archive,
      `-o${resources}`,
      "-y",
      "-ir!*Contents/Resources/app.asar",
      "-ir!*Contents/Resources/app.asar.unpacked/*",
      "-ir!*Contents/Resources/*.icns",
      "-ir!*Info.plist",
    ]);
    const bundles = await findBundles(resources);
    if (bundles.length !== 1)
      throw new Error(`Expected one app.asar in the DMG, found ${bundles.length}`);
    const bundle = bundles[0];
    const framework = path.join(
      path.dirname(path.dirname(bundle)),
      "Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist",
    );
    const electronVersion = plist.parse(await readFile(framework, "utf8")).CFBundleVersion;
    validateVersion(electronVersion);
    const staged = path.join(work, "app");
    extractAll(bundle, staged);
    const { version } = await readJson(path.join(staged, "package.json"));
    validateVersion(version);
    // Reinstall dependencies for Linux; macOS modules are not portable.
    await rm(path.join(staged, "node_modules"), { recursive: true, force: true });
    await extractIcons(
      path.join(path.dirname(bundle), "electron.icns"),
      path.join(staged, "build/icons"),
    );
    await writeJson(path.join(staged, ".norc-upstream.json"), {
      version,
      electronVersion,
      sourceUrl: dmg ? null : url,
      resolvedUrl,
      dmgSha256,
    });
    await rename(staged, output);
    console.info(`Extracted Notion Calendar ${version} to ${output} (Electron ${electronVersion})`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
cli(import.meta.url, async () => {
  const options = parseOptions();
  if (options.help)
    console.info("npm run extract -- [--dmg FILE | --url URL] [--output DIRECTORY]");
  else await prepareApp(options);
});
