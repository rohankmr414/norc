import path from "node:path";
import { ROOT, TARGETS, cli, parseOptions, readJson, run } from "./common.mjs";
import { prepareApp } from "./extract.mjs";
import { patchApp } from "./patch.mjs";
import { validateTag, writeReleaseMetadata } from "./release.mjs";

export async function buildApp(options) {
  if (options.help) {
    console.info("npm run build -- [deb pacman rpm] [--arch x64|arm64] [--dmg FILE] [--output DIRECTORY] [--reuse]");
    return;
  }
  if (process.platform !== "linux") throw new Error("Norc packages must be built on Linux");
  for (const target of options.targets) {
    if (!TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}; use deb, pacman or rpm`);
  }
  if (options.reuse && options.dmg) throw new Error("--reuse and --dmg cannot be used together");
  if (!options.reuse) await prepareApp(options);
  const { version } = await readJson(path.join(options.output, ".norc-upstream.json"));
  const releaseTag = options["release-tag"] || process.env.NORC_RELEASE_TAG;
  if (releaseTag) {
    validateTag(releaseTag, version, "upstream Notion Calendar");
    validateTag(releaseTag, (await readJson(path.join(ROOT, "package.json"))).version);
  }
  await patchApp(options);
  await run("npm", ["install", "--include=dev", "--no-audit", "--no-fund"], { cwd: options.output });
  const builder = path.join(ROOT, "node_modules/.bin/electron-builder");
  const args = ["--projectDir", options.output, `--config.afterPack=${path.join(ROOT, "scripts/launcher.mjs")}`,
    "--linux", ...options.targets, `--${options.arch}`, "--publish", "never"];
  if (options["electron-dist"]) args.push(`--config.electronDist=${path.resolve(options["electron-dist"])}`);
  await run(builder, args);
  await writeReleaseMetadata({ ...options, version });
}
cli(import.meta.url, async () => buildApp(parseOptions()));
