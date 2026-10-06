import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import semver from "semver";
import { DOWNLOAD_URL, cli, validateVersion } from "./common.mjs";
import { githubGet } from "./github.mjs";

export function upstreamFromUrl(downloadUrl) {
  const url = new URL(downloadUrl);
  if (url.protocol !== "https:") throw new Error("The upstream download must use HTTPS");
  const filename = decodeURIComponent(url.pathname.split("/").at(-1));
  const match = /^Notion Calendar-(.+)-universal\.dmg$/.exec(filename);
  if (!match) throw new Error(`Unrecognized upstream download filename: ${filename}`);
  const version = validateVersion(match[1]);
  return { version, tag: `v${version}`, downloadUrl: url.href };
}
export async function discoverUpstream({ url = DOWNLOAD_URL, fetchImpl = fetch } = {}) {
  // Resolve the official redirect without downloading the 200+ MB bundle.
  const response = await fetchImpl(url, {
    method: "HEAD",
    headers: { "User-Agent": "Norc-build" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Upstream version check failed: HTTP ${response.status}`);
  return upstreamFromUrl(response.url);
}
export function planUpdate(upstream, releases, tagExists = false) {
  validateVersion(upstream.version);
  const published = releases.filter((release) => !release.draft);
  const existing = published.find((release) => release.tag_name === upstream.tag);
  const newer = published.find((release) => {
    const version = release.tag_name?.startsWith("v") ? release.tag_name.slice(1) : null;
    return semver.valid(version) && semver.gt(version, upstream.version);
  });
  const available = !existing && !newer;
  return {
    ...upstream,
    available,
    tagExists,
    reason: existing
      ? "already published"
      : newer
        ? `older than published ${newer.tag_name}`
        : "unreleased upstream version",
  };
}
export async function checkUpstream({ repo, url, fetchImpl = fetch } = {}) {
  const upstream = await discoverUpstream({ url, fetchImpl });
  const options = { repo, fetchImpl };
  const releases = await githubGet("releases?per_page=100", options);
  const existing = await githubGet(`releases/tags/${encodeURIComponent(upstream.tag)}`, {
    ...options,
    allowMissing: true,
  });
  const plan = planUpdate(upstream, existing ? [...releases, existing] : releases);
  if (plan.available) {
    plan.tagExists = Boolean(
      await githubGet(`git/ref/tags/${encodeURIComponent(upstream.tag)}`, {
        ...options,
        allowMissing: true,
      }),
    );
  }
  return plan;
}
export async function writeCheckOutputs(plan, filename) {
  const values = {
    available: String(plan.available),
    version: plan.version,
    tag: plan.tag,
    "download-url": plan.downloadUrl,
    "tag-exists": String(plan.tagExists),
  };
  for (const value of Object.values(values)) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid multiline workflow output");
  }
  await appendFile(
    filename,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}
cli(import.meta.url, async () => {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: process.env.GH_REPO || process.env.GITHUB_REPOSITORY },
      url: { type: "string", default: DOWNLOAD_URL },
    },
  });
  const plan = await checkUpstream(values);
  console.info(`Notion Calendar ${plan.version}: ${plan.reason}`);
  console.info(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) await writeCheckOutputs(plan, process.env.GITHUB_OUTPUT);
});
