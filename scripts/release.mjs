import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import { ROOT, artifactNames, cli, hashFile, readJson, run, validateVersion, writeJson } from "./common.mjs";
import { githubGet } from "./github.mjs";

export function validateTag(tag, version, source = "package.json") {
  validateVersion(version);
  if (tag !== `v${version}`) throw new Error(`Release tag ${JSON.stringify(tag)} must match ${source} version: v${version}`);
  return tag;
}
export async function writeReleaseMetadata({ output, version, arch, targets }) {
  const directory = path.join(output, "release");
  const names = artifactNames(version, arch);
  const assets = [];
  for (const target of [...new Set(targets)].sort()) {
    const name = names[target];
    assets.push({ name, sha256: await hashFile(path.join(directory, name)) });
  }
  const metadata = {
    name: "norc", version, architecture: arch,
    upstream: await readJson(path.join(output, ".norc-upstream.json")),
    commit: process.env.NORC_SOURCE_COMMIT || process.env.GITHUB_SHA || null, assets,
  };
  await writeJson(path.join(directory, "build-info.json"), metadata);
  const checksums = [...assets, { name: "build-info.json", sha256: await hashFile(path.join(directory, "build-info.json")) }];
  await writeFile(path.join(directory, "SHA256SUMS"), checksums.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""));
  console.info(`Release packages, build-info.json and SHA256SUMS: ${directory}`);
  return metadata;
}
export function releaseCommands(tag, metadata, directory, notesFile, { existingRelease, resumeDraft = false } = {}) {
  validateTag(tag, metadata.version);
  const prerelease = Boolean(semver.prerelease(metadata.version));
  const assets = [...metadata.assets.map(({ name }) => path.join(directory, name)),
    path.join(directory, "build-info.json"), path.join(directory, "SHA256SUMS")];
  if (existingRelease) {
    if (!existingRelease.draft) throw new Error(`Release ${tag} is already published`);
    if (!resumeDraft || existingRelease.tag_name !== tag) throw new Error(`Cannot resume draft release ${tag}`);
    return [
      ["release", "upload", tag, ...assets, "--clobber"],
      ["release", "edit", tag, "--draft=false", `--prerelease=${prerelease}`, `--latest=${!prerelease}`],
    ];
  }
  return [
    ["release", "create", tag, ...assets, "--verify-tag", "--draft", "--title", `Norc ${tag}`,
      "--generate-notes", "--notes-file", notesFile, ...(prerelease ? ["--prerelease"] : [])],
    ["release", "edit", tag, "--draft=false", `--latest=${!prerelease}`],
  ];
}
export async function verifyRelease(directory, version) {
  const metadata = await readJson(path.join(directory, "build-info.json"));
  validateTag(`v${metadata.version}`, version);
  if (metadata.version !== metadata.upstream?.version) throw new Error("Norc release version must match upstream Notion Calendar");
  if (metadata.name !== "norc" || !metadata.assets?.length) throw new Error("Invalid Norc release metadata");
  const allowed = new Set(Object.values(artifactNames(version, metadata.architecture)));
  for (const { name, sha256 } of metadata.assets) {
    if (!allowed.has(name) || await hashFile(path.join(directory, name)) !== sha256) {
      throw new Error(`Invalid release asset or checksum: ${name}`);
    }
    allowed.delete(name);
  }
  const entries = [...metadata.assets, { name: "build-info.json", sha256: await hashFile(path.join(directory, "build-info.json")) }];
  const expected = entries.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
  if (await readFile(path.join(directory, "SHA256SUMS"), "utf8") !== expected) throw new Error("SHA256SUMS does not match release assets");
  return metadata;
}
cli(import.meta.url, async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true, options: {
      directory: { type: "string", default: "release" }, "resume-draft": { type: "boolean", default: false },
    },
  });
  const [operation, tag] = positionals;
  const { version } = await readJson(path.join(ROOT, "package.json"));
  validateTag(tag, version);
  if (operation === "check") { console.info(`Valid Norc release tag: ${tag}`); return; }
  if (operation !== "publish") throw new Error("Usage: node scripts/release.mjs check|publish v<VERSION> [--directory DIRECTORY]");
  const directory = path.resolve(values.directory);
  const metadata = await verifyRelease(directory, version);
  const existingRelease = values["resume-draft"]
    ? await githubGet(`releases/tags/${encodeURIComponent(tag)}`, { allowMissing: true }) : null;
  if (existingRelease && !existingRelease.draft) {
    console.info(`Release ${tag} is already published; skipping`);
    return;
  }
  const notesFile = path.join(directory, "release-notes.md");
  await writeFile(notesFile, `Norc ${tag}\n\nUnofficial Linux packages of Notion Calendar ${metadata.upstream.version}, using Electron ${metadata.upstream.electronVersion}.\n\nVerify downloads with \`sha256sum -c SHA256SUMS\`. Upstream source details and hashes are recorded in \`build-info.json\`.\n`);
  // Upload as a draft so an interrupted upload cannot publish incomplete assets.
  // Only an explicitly resumed, unpublished draft can have assets replaced.
  for (const args of releaseCommands(tag, metadata, directory, notesFile, {
    existingRelease, resumeDraft: values["resume-draft"],
  })) await run("gh", args);
});
