import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, cli, parseOptions, readJson, validateVersion, writeJson } from "./common.mjs";

export async function syncIcons({ output, destination = path.join(ROOT, "icons") }) {
  const upstream = await readJson(path.join(output, ".norc-upstream.json"));
  validateVersion(upstream.version);
  if (!/^[a-f0-9]{64}$/.test(upstream.dmgSha256 || "")) throw new Error("Missing upstream DMG checksum for icon provenance");
  const source = path.join(output, "build/icons");
  const images = [];
  for (const filename of await readdir(source)) {
    const match = /^(\d+)x\1\.png$/.exec(filename);
    if (!match) continue;
    const size = Number(match[1]);
    const data = await readFile(path.join(source, filename));
    if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      data.readUInt32BE(16) !== size || data.readUInt32BE(20) !== size) {
      throw new Error(`Invalid upstream PNG icon: ${filename}`);
    }
    images.push({ size, name: `icon_${filename}`, data, sha256: createHash("sha256").update(data).digest("hex") });
  }
  if (!images.some(({ size }) => size === 512)) throw new Error("The upstream icon set must include a 512px PNG");
  images.sort((left, right) => left.size - right.size);
  // Validate the complete new set before replacing or pruning existing icons.
  await mkdir(destination, { recursive: true });
  for (const { name, data } of images) await writeFile(path.join(destination, name), data);
  const names = new Set(images.map(({ name }) => name));
  for (const filename of await readdir(destination)) {
    if (/^icon_\d+x\d+\.png$/.test(filename) && !names.has(filename)) await rm(path.join(destination, filename));
  }
  await writeJson(path.join(destination, "upstream.json"), {
    version: upstream.version, dmgSha256: upstream.dmgSha256,
    assets: images.map(({ name, sha256 }) => ({ name, sha256 })),
  });
  console.info(`Updated ${images.length} Notion Calendar ${upstream.version} icons in ${destination}`);
}
cli(import.meta.url, async () => {
  const options = parseOptions();
  if (options.help) console.info("npm run icons:sync -- [--output DIRECTORY]");
  else await syncIcons(options);
});
