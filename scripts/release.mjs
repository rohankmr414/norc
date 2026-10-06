import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import {
  ROOT,
  artifactNames,
  cli,
  hashFile,
  readJson,
  releaseIdentity,
  run,
  validateRevision,
  validateVersion,
  writeJson,
} from "./common.mjs";
import { githubGet } from "./github.mjs";

export function validateTag(tag, version, source = "package.json", revision) {
  validateVersion(version);
  let identity;
  try {
    identity = releaseIdentity(tag);
  } catch {
    throw new Error(`Release tag ${JSON.stringify(tag)} must match ${source} version: v${version}`);
  }
  if (identity.version !== version)
    throw new Error(`Release tag ${JSON.stringify(tag)} must match ${source} version: v${version}`);
  if (revision !== undefined && identity.revision !== validateRevision(revision)) {
    throw new Error(`Release tag ${JSON.stringify(tag)} must match package revision ${revision}`);
  }
  return tag;
}
export async function writeReleaseMetadata({ output, version, arch, targets, revision = 1 }) {
  revision = validateRevision(revision);
  const directory = path.join(output, "release");
  const names = artifactNames(version, arch, revision);
  const assets = [];
  for (const target of [...new Set(targets)].sort()) {
    const name = names[target];
    assets.push({ name, sha256: await hashFile(path.join(directory, name)) });
  }
  const metadata = {
    name: "norc",
    version,
    revision,
    architecture: arch,
    upstream: await readJson(path.join(output, ".norc-upstream.json")),
    commit: process.env.NORC_SOURCE_COMMIT || process.env.GITHUB_SHA || null,
    assets,
  };
  await writeJson(path.join(directory, "build-info.json"), metadata);
  const checksums = [
    ...assets,
    { name: "build-info.json", sha256: await hashFile(path.join(directory, "build-info.json")) },
  ];
  await writeFile(
    path.join(directory, "SHA256SUMS"),
    checksums.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""),
  );
  console.info(`Release packages, build-info.json and SHA256SUMS: ${directory}`);
  return metadata;
}
export function releaseCommands(
  tag,
  metadata,
  directory,
  notesFile,
  { existingRelease, resumeDraft = false, makeLatest } = {},
) {
  validateTag(tag, metadata.version, "build metadata", metadata.revision ?? 1);
  const prerelease = Boolean(semver.prerelease(metadata.version));
  const latest = !prerelease && (makeLatest ?? true);
  const assets = [
    ...metadata.assets.map(({ name }) => path.join(directory, name)),
    path.join(directory, "build-info.json"),
    path.join(directory, "SHA256SUMS"),
  ];
  if (existingRelease) {
    if (!existingRelease.draft) throw new Error(`Release ${tag} is already published`);
    if (!resumeDraft || existingRelease.tag_name !== tag)
      throw new Error(`Cannot resume draft release ${tag}`);
    return [
      ["release", "upload", tag, ...assets, "--clobber"],
      ["release", "edit", tag, "--draft=false", `--prerelease=${prerelease}`, `--latest=${latest}`],
    ];
  }
  return [
    [
      "release",
      "create",
      tag,
      ...assets,
      "--verify-tag",
      "--draft",
      "--title",
      `Norc ${tag}`,
      "--generate-notes",
      "--notes-file",
      notesFile,
      ...(prerelease ? ["--prerelease"] : []),
    ],
    ["release", "edit", tag, "--draft=false", `--latest=${latest}`],
  ];
}
export function shouldMarkLatest(tag, currentLatest) {
  const next = releaseIdentity(tag);
  if (semver.prerelease(next.version)) return false;
  if (!currentLatest) return true;
  let current;
  try {
    current = releaseIdentity(currentLatest.tag_name);
  } catch {
    return true;
  }
  const comparison = semver.compare(next.version, current.version);
  return comparison > 0 || (comparison === 0 && next.revision >= current.revision);
}
export async function verifyRelease(directory, version, revision) {
  const metadata = await readJson(path.join(directory, "build-info.json"));
  validateTag(`v${metadata.version}`, version);
  const packageRevision = validateRevision(metadata.revision ?? 1);
  if (revision !== undefined && packageRevision !== validateRevision(revision))
    throw new Error("Release metadata does not match the tag's package revision");
  if (metadata.version !== metadata.upstream?.version)
    throw new Error("Norc release version must match upstream Notion Calendar");
  if (metadata.name !== "norc" || !metadata.assets?.length)
    throw new Error("Invalid Norc release metadata");
  const allowed = new Set(
    Object.values(artifactNames(version, metadata.architecture, packageRevision)),
  );
  for (const { name, sha256 } of metadata.assets) {
    if (!allowed.has(name) || (await hashFile(path.join(directory, name))) !== sha256) {
      throw new Error(`Invalid release asset or checksum: ${name}`);
    }
    allowed.delete(name);
  }
  const entries = [
    ...metadata.assets,
    { name: "build-info.json", sha256: await hashFile(path.join(directory, "build-info.json")) },
  ];
  const expected = entries.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
  if ((await readFile(path.join(directory, "SHA256SUMS"), "utf8")) !== expected)
    throw new Error("SHA256SUMS does not match release assets");
  return metadata;
}
cli(import.meta.url, async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      directory: { type: "string", default: "release" },
      "resume-draft": { type: "boolean", default: false },
    },
  });
  const [operation, tag] = positionals;
  const { version } = await readJson(path.join(ROOT, "package.json"));
  validateTag(tag, version);
  if (operation === "check") {
    console.info(`Valid Norc release tag: ${tag}`);
    return;
  }
  if (operation !== "publish")
    throw new Error(
      "Usage: node scripts/release.mjs check|publish v<VERSION>[-linux.N] [--directory DIRECTORY]",
    );
  const directory = path.resolve(values.directory);
  const metadata = await verifyRelease(directory, version, releaseIdentity(tag).revision);
  const existingRelease = values["resume-draft"]
    ? await githubGet(`releases/tags/${encodeURIComponent(tag)}`, { allowMissing: true })
    : null;
  if (existingRelease && !existingRelease.draft) {
    console.info(`Release ${tag} is already published; skipping`);
    return;
  }
  const notesFile = path.join(directory, "release-notes.md");
  await writeFile(
    notesFile,
    `Norc ${tag}\n\nUnofficial Linux packages of Notion Calendar ${metadata.upstream.version}, using Electron ${metadata.upstream.electronVersion}. Package revision: ${metadata.revision ?? 1}.\n\nVerify downloads with \`sha256sum -c SHA256SUMS\`. Upstream source details and hashes are recorded in \`build-info.json\`.\n`,
  );
  const currentLatest = await githubGet("releases/latest", { allowMissing: true });
  // Upload as a draft so an interrupted upload cannot publish incomplete assets.
  // Only an explicitly resumed, unpublished draft can have assets replaced.
  for (const args of releaseCommands(tag, metadata, directory, notesFile, {
    existingRelease,
    resumeDraft: values["resume-draft"],
    makeLatest: shouldMarkLatest(tag, currentLatest),
  }))
    await run("gh", args);
});
