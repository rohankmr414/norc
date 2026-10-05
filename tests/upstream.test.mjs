import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { githubGet } from "../scripts/github.mjs";
import { checkUpstream, discoverUpstream, planUpdate, upstreamFromUrl, writeCheckOutputs } from "../scripts/upstream.mjs";

const downloadUrl = "https://calendar-desktop-release.notion-static.com/Notion%20Calendar-1.139.0-universal.dmg";
const upstream = upstreamFromUrl(downloadUrl);
test("the lightweight version check resolves the official redirect and pins the download", async () => {
  const result = await discoverUpstream({ fetchImpl: async (url, options) => {
    assert.match(url, /www\.notion\.com/);
    assert.equal(options.method, "HEAD");
    return { ok: true, url: downloadUrl };
  } });
  assert.deepEqual(result, { version: "1.139.0", tag: "v1.139.0", downloadUrl });
  await assert.rejects(discoverUpstream({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  for (const invalid of [downloadUrl.replace("https:", "http:"), downloadUrl.replace("1.139.0", "latest"), "https://example.com/download"]) {
    assert.throws(() => upstreamFromUrl(invalid));
  }
});
test("already published versions and upstream rollbacks are skipped; drafts and new versions can proceed", () => {
  assert.equal(planUpdate(upstream, []).available, true);
  assert.equal(planUpdate(upstream, [{ tag_name: "latest", draft: false }]).available, true);
  assert.equal(planUpdate(upstream, [{ tag_name: "v1.139.0", draft: false }]).available, false);
  assert.equal(planUpdate(upstream, [{ tag_name: "v1.140.0", draft: false }]).available, false);
  const retry = planUpdate(upstream, [{ tag_name: "v1.139.0", draft: true }], true);
  assert.equal(retry.available, true);
  assert.equal(retry.tagExists, true);
  const preview = upstreamFromUrl(downloadUrl.replace("1.139.0", "1.140.0-beta.1"));
  assert.equal(planUpdate(preview, [{ tag_name: "v1.139.0", draft: false }]).available, true);
});
test("GitHub errors stop the check; only an explicitly allowed 404 means absence", async () => {
  const options = { repo: "owner/norc", fetchImpl: async () => ({ ok: false, status: 404 }) };
  assert.equal(await githubGet("releases/tags/v1.139.0", { ...options, allowMissing: true }), null);
  await assert.rejects(githubGet("releases", options), /HTTP 404/);
  await assert.rejects(githubGet("releases", { ...options, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
test("an interrupted release with an existing tag is retried using that tag", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!url.startsWith("https://api.github.com")) return { ok: true, url: downloadUrl };
    if (url.endsWith("releases?per_page=100")) return { ok: true, json: async () => [] };
    if (url.includes("releases/tags/")) return { ok: false, status: 404 };
    if (url.includes("git/ref/tags/")) return { ok: true, json: async () => ({ object: { sha: "a".repeat(40) } }) };
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await checkUpstream({ repo: "owner/norc", fetchImpl });
  assert.equal(result.available, true);
  assert.equal(result.tagExists, true);
  assert.equal(calls.length, 4);
});
test("workflow outputs contain the pinned version and URL without multiline injection", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "norc-check-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "output");
  const plan = planUpdate(upstream, []);
  await writeCheckOutputs(plan, filename);
  assert.match(await readFile(filename, "utf8"), /available=true\nversion=1\.139\.0\ntag=v1\.139\.0\n/);
  await assert.rejects(writeCheckOutputs({ ...plan, downloadUrl: "https://example.com\navailable=false" }, filename), /multiline/);
});
