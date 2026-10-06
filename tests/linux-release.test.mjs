import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkLinuxPatch,
  pinnedUpstream,
  planLinuxPatch,
  writeLinuxPatchOutputs,
} from "../scripts/linux-release.mjs";

const tag = "v1.139.0-linux.2";
const downloadUrl =
  "https://calendar-desktop-release.notion-static.com/Notion%20Calendar-1.139.0-universal.dmg";
const metadata = {
  name: "norc",
  version: "1.139.0",
  upstream: {
    version: "1.139.0",
    electronVersion: "41.5.0",
    resolvedUrl: downloadUrl,
    dmgSha256: "a".repeat(64),
  },
};

test("Linux patches increment the native revision and never rebuild published releases", () => {
  assert.equal(planLinuxPatch(tag, [{ tag_name: "v1.139.0", draft: false }]).available, true);
  assert.equal(planLinuxPatch(tag, [{ tag_name: tag, draft: false }]).available, false);
  assert.equal(planLinuxPatch(tag, [{ tag_name: tag, draft: true }], true).tagExists, true);
  assert.throws(
    () => planLinuxPatch(tag, [{ tag_name: "v1.139.0-linux.3", draft: false }]),
    /higher than published/,
  );
  assert.throws(() => planLinuxPatch("v1.139.0", []), /Linux patch tag/);
});

test("patch builds require the published base release's matching upstream URL and checksum", () => {
  assert.deepEqual(pinnedUpstream(metadata, "1.139.0"), { downloadUrl, dmgSha256: "a".repeat(64) });
  for (const changed of [
    { ...metadata, version: "1.140.0" },
    { ...metadata, upstream: { ...metadata.upstream, version: "1.140.0" } },
    { ...metadata, upstream: { ...metadata.upstream, dmgSha256: undefined } },
    { ...metadata, upstream: { ...metadata.upstream, resolvedUrl: undefined } },
    {
      ...metadata,
      upstream: { ...metadata.upstream, resolvedUrl: downloadUrl.replace("1.139.0", "1.140.0") },
    },
    {
      ...metadata,
      upstream: { ...metadata.upstream, resolvedUrl: downloadUrl.replace("https:", "http:") },
    },
  ])
    assert.throws(() => pinnedUpstream(changed, "1.139.0"));
});

function mockGithub({
  published = false,
  baseMissing = false,
  tagExists = false,
  metadataStatus = 200,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const response = (data, status = 200) => ({
      ok: status === 200,
      status,
      json: async () => data,
    });
    if (url.endsWith("releases?per_page=100")) return response([]);
    if (url.endsWith(`releases/tags/${tag}`))
      return response(published ? { tag_name: tag, draft: false } : null, published ? 200 : 404);
    if (url.includes("git/ref/tags/")) return response({}, tagExists ? 200 : 404);
    if (url.endsWith("releases/tags/v1.139.0"))
      return response(
        {
          draft: false,
          assets: [
            {
              name: "build-info.json",
              browser_download_url:
                "https://github.com/owner/norc/releases/download/v1.139.0/build-info.json",
            },
          ],
        },
        baseMissing ? 404 : 200,
      );
    if (url.startsWith("https://github.com/")) return response(metadata, metadataStatus);
    throw new Error(`Unexpected request ${url}`);
  };
  return { calls, fetchImpl };
}

test("release planning pins a historical upstream bundle and reuses existing source tags", async () => {
  const mock = mockGithub({ tagExists: true });
  const plan = await checkLinuxPatch({ tag, repo: "owner/norc", fetchImpl: mock.fetchImpl });
  assert.equal(plan.available, true);
  assert.equal(plan.tagExists, true);
  assert.equal(plan.revision, 2);
  assert.equal(plan.downloadUrl, downloadUrl);
  assert.equal(plan.dmgSha256, "a".repeat(64));
  assert.equal(mock.calls.length, 5);
  assert.equal(mock.calls.at(-1).options.headers, undefined);
});

test("published releases skip downloads; missing provenance and GitHub errors stop the build", async () => {
  const published = mockGithub({ published: true });
  assert.equal(
    (await checkLinuxPatch({ tag, repo: "owner/norc", fetchImpl: published.fetchImpl })).available,
    false,
  );
  assert.equal(published.calls.length, 2);
  await assert.rejects(
    checkLinuxPatch({
      tag,
      repo: "owner/norc",
      fetchImpl: mockGithub({ baseMissing: true }).fetchImpl,
    }),
    /base upstream release/,
  );
  await assert.rejects(
    checkLinuxPatch({
      tag,
      repo: "owner/norc",
      fetchImpl: mockGithub({ metadataStatus: 503 }).fetchImpl,
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    checkLinuxPatch({
      tag,
      repo: "owner/norc",
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }),
    /HTTP 403/,
  );
});

test("revision checks include older pages of release history", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("releases?per_page=100"))
      return {
        ok: true,
        json: async () =>
          Array.from({ length: 100 }, (_, i) => ({ tag_name: `unrelated-${i}`, draft: false })),
      };
    if (url.endsWith("releases?per_page=100&page=2"))
      return { ok: true, json: async () => [{ tag_name: "v1.139.0-linux.3", draft: false }] };
    if (url.includes("releases/tags/")) return { ok: false, status: 404 };
    throw new Error(`Unexpected request ${url}`);
  };
  await assert.rejects(
    checkLinuxPatch({ tag, repo: "owner/norc", fetchImpl }),
    /higher than published/,
  );
  assert.equal(calls.length, 3);
});

test("workflow outputs include package revision and the pinned checksum without multiline injection", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "norc-linux-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "outputs");
  const plan = { ...planLinuxPatch(tag, []), downloadUrl, dmgSha256: "a".repeat(64) };
  await writeLinuxPatchOutputs(plan, filename);
  const outputs = await readFile(filename, "utf8");
  assert.match(outputs, /revision=2\n/);
  assert.match(outputs, /dmg-sha256=a{64}\n/);
  await assert.rejects(
    writeLinuxPatchOutputs({ ...plan, downloadUrl: `${downloadUrl}\navailable=false` }, filename),
    /multiline/,
  );
});
