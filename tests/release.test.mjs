import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactNames, writeJson } from "../scripts/common.mjs";
import { releaseCommands, validateTag, verifyRelease, writeReleaseMetadata } from "../scripts/release.mjs";

test("release tags match the exact package SemVer version", () => {
  assert.equal(validateTag("v1.0.0", "1.0.0"), "v1.0.0");
  assert.equal(validateTag("v1.1.0-beta.1", "1.1.0-beta.1"), "v1.1.0-beta.1");
  for (const tag of ["latest", "1.0.0", "v2.0.0"]) assert.throws(() => validateTag(tag, "1.0.0"), /must match/);
  for (const version of ["01.0.0", "1.0", "v1.0.0", "1.0.0+build.1"]) {
    assert.throws(() => validateTag(`v${version}`, version), /SemVer/);
  }
});
test("releases upload assets to a verified tag before publishing and mark prereleases", () => {
  for (const version of ["1.0.0", "1.1.0-beta.1"]) {
    const [create, publish] = releaseCommands(`v${version}`, {
      version, assets: [{ name: artifactNames(version, "x64").rpm }],
    }, "/release", "/release/notes.md");
    assert.ok(create.includes("--verify-tag"));
    assert.ok(create.includes("--draft"));
    assert.ok(create.includes("/release/SHA256SUMS"));
    assert.equal(create.includes("--prerelease"), version.includes("beta"));
    assert.ok(publish.includes("--draft=false"));
    assert.ok(publish.includes(`--latest=${!version.includes("beta")}`));
    assert.equal(create.includes("--clobber"), false);
  }
});
test("only unpublished drafts can have their assets replaced during a retry", () => {
  const metadata = { version: "1.139.0", assets: [{ name: "norc-1.139.0-1.x86_64.rpm" }] };
  const draft = { tag_name: "v1.139.0", draft: true };
  const [upload, publish] = releaseCommands("v1.139.0", metadata, "/release", "/release/notes.md", {
    existingRelease: draft, resumeDraft: true,
  });
  assert.deepEqual(upload.slice(0, 3), ["release", "upload", "v1.139.0"]);
  assert.ok(upload.includes("--clobber"));
  assert.ok(publish.includes("--draft=false"));
  assert.throws(() => releaseCommands("v1.139.0", metadata, "/release", "/release/notes.md", {
    existingRelease: { ...draft, draft: false }, resumeDraft: true,
  }), /already published/);
  assert.throws(() => releaseCommands("v1.139.0", metadata, "/release", "/release/notes.md", {
    existingRelease: draft,
  }), /Cannot resume/);
});
test("release metadata records upstream versions and rejects modified artifacts or checksums", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "norc-release-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = path.join(output, "release");
  await mkdir(directory);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0", electronVersion: "41.5.0", dmgSha256: "a".repeat(64),
  });
  const name = artifactNames("1.139.0", "x64").rpm;
  await writeFile(path.join(directory, name), "test-package");
  await writeReleaseMetadata({ output, version: "1.139.0", arch: "x64", targets: ["rpm"] });
  const metadata = await verifyRelease(directory, "1.139.0");
  assert.equal(metadata.upstream.version, "1.139.0");
  assert.equal(metadata.assets.length, 1);
  await writeJson(path.join(directory, "build-info.json"), {
    ...metadata, upstream: { ...metadata.upstream, version: "1.140.0" },
  });
  await assert.rejects(verifyRelease(directory, "1.139.0"), /must match upstream/);
  await writeJson(path.join(directory, "build-info.json"), metadata);
  const checksums = await readFile(path.join(directory, "SHA256SUMS"), "utf8");
  assert.match(checksums, /[a-f0-9]{64}  build-info\.json/);
  await assert.rejects(verifyRelease(directory, "2.0.0"), /must match/);
  await writeFile(path.join(directory, "SHA256SUMS"), "changed");
  await assert.rejects(verifyRelease(directory, "1.139.0"), /SHA256SUMS/);
  await writeFile(path.join(directory, "SHA256SUMS"), checksums);
  await writeFile(path.join(directory, name), "tampered-package");
  await assert.rejects(verifyRelease(directory, "1.139.0"), /checksum/);
});
