import { appendFile } from "node:fs/promises";
import { cli, releaseIdentity, validateVersion } from "./common.mjs";
import { githubGet, githubReleases } from "./github.mjs";
import { upstreamFromUrl } from "./upstream.mjs";

export function planLinuxPatch(tag, releases, tagExists = false) {
  const { version, revision } = releaseIdentity(tag);
  if (revision < 2) throw new Error("Use a Linux patch tag such as v1.139.0-linux.2");
  const published = releases.filter((release) => !release.draft);
  const existing = published.find((release) => release.tag_name === tag);
  const later = published.find((release) => {
    try {
      const identity = releaseIdentity(release.tag_name);
      return identity.version === version && identity.revision >= revision;
    } catch {
      return false;
    }
  });
  if (!existing && later)
    throw new Error(`Package revision ${revision} must be higher than published ${later.tag_name}`);
  return {
    tag,
    version,
    revision,
    available: !existing,
    tagExists,
    reason: existing ? "already published" : "unreleased Linux package revision",
  };
}

export function pinnedUpstream(metadata, version) {
  if (
    metadata.name !== "norc" ||
    metadata.version !== version ||
    metadata.upstream?.version !== version
  ) {
    throw new Error("Base release metadata does not match the upstream app version");
  }
  validateVersion(metadata.upstream.electronVersion);
  const { resolvedUrl, dmgSha256 } = metadata.upstream;
  if (!/^[a-f0-9]{64}$/.test(dmgSha256 || ""))
    throw new Error("Base release is missing the upstream DMG checksum");
  if (!resolvedUrl || upstreamFromUrl(resolvedUrl).version !== version) {
    throw new Error("Base release is missing a pinned download for this upstream version");
  }
  return { downloadUrl: resolvedUrl, dmgSha256 };
}

export async function checkLinuxPatch({ tag, repo, fetchImpl = fetch } = {}) {
  planLinuxPatch(tag, []);
  const options = { repo, fetchImpl };
  const releases = await githubReleases(options);
  const existing = await githubGet(`releases/tags/${encodeURIComponent(tag)}`, {
    ...options,
    allowMissing: true,
  });
  const plan = planLinuxPatch(tag, existing ? [...releases, existing] : releases);
  if (!plan.available) return plan;
  plan.tagExists = Boolean(
    await githubGet(`git/ref/tags/${encodeURIComponent(tag)}`, { ...options, allowMissing: true }),
  );
  const baseTag = `v${plan.version}`;
  const base = await githubGet(`releases/tags/${encodeURIComponent(baseTag)}`, {
    ...options,
    allowMissing: true,
  });
  if (!base || base.draft)
    throw new Error(`Publish the base upstream release ${baseTag} before creating a Linux patch`);
  const asset = base.assets?.find((asset) => asset.name === "build-info.json");
  if (!asset) throw new Error(`Base release ${baseTag} is missing build-info.json`);
  const url = new URL(asset.browser_download_url);
  const repository = repo || process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (
    url.origin !== "https://github.com" ||
    decodeURIComponent(url.pathname) !==
      `/${repository}/releases/download/${baseTag}/build-info.json`
  ) {
    throw new Error("Invalid base release metadata URL");
  }
  const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new Error(`Base release metadata download failed: HTTP ${response.status}`);
  return { ...plan, ...pinnedUpstream(await response.json(), plan.version) };
}

export async function writeLinuxPatchOutputs(plan, filename) {
  const values = {
    available: String(plan.available),
    tag: plan.tag,
    version: plan.version,
    revision: String(plan.revision),
    "tag-exists": String(plan.tagExists),
    "download-url": plan.downloadUrl || "",
    "dmg-sha256": plan.dmgSha256 || "",
  };
  if (Object.values(values).some((value) => /[\r\n]/.test(value)))
    throw new Error("Invalid multiline workflow output");
  await appendFile(
    filename,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

cli(import.meta.url, async () => {
  const tag = process.argv[2];
  // Reject malformed input before making any GitHub requests.
  const identity = releaseIdentity(tag);
  if (identity.revision < 2) throw new Error("Use v<VERSION>-linux.N, with N at least 2");
  const plan = await checkLinuxPatch({ tag });
  console.info(`Norc ${tag}: ${plan.reason}`);
  if (process.env.GITHUB_OUTPUT) await writeLinuxPatchOutputs(plan, process.env.GITHUB_OUTPUT);
});
