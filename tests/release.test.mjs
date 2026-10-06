import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactNames,
  parseOptions,
  releaseIdentity,
  releaseTag,
  validateRevision,
  writeJson,
} from "../scripts/common.mjs";
import {
  releaseCommands,
  shouldMarkLatest,
  validateTag,
  verifyRelease,
  writeReleaseMetadata,
} from "../scripts/release.mjs";

test("release tags match the exact package SemVer version", () => {
  assert.equal(validateTag("v1.0.0", "1.0.0"), "v1.0.0");
  assert.equal(validateTag("v1.1.0-beta.1", "1.1.0-beta.1"), "v1.1.0-beta.1");
  for (const tag of ["latest", "1.0.0", "v2.0.0"])
    assert.throws(() => validateTag(tag, "1.0.0"), /must match/);
  for (const version of ["01.0.0", "1.0", "v1.0.0", "1.0.0+build.1"]) {
    assert.throws(() => validateTag(`v${version}`, version), /SemVer/);
  }
});
test("Linux tags preserve upstream versions and carry a canonical increasing package revision", () => {
  assert.equal(releaseTag("1.139.0", 1), "v1.139.0");
  assert.equal(releaseTag("1.139.0", 2), "v1.139.0-linux.2");
  assert.deepEqual(releaseIdentity("v1.139.0-linux.2"), { version: "1.139.0", revision: 2 });
  assert.deepEqual(releaseIdentity("v1.140.0-beta.1-linux.3"), {
    version: "1.140.0-beta.1",
    revision: 3,
  });
  assert.equal(validateTag("v1.139.0-linux.2", "1.139.0", "package.json", 2), "v1.139.0-linux.2");
  assert.throws(
    () => validateTag("v1.139.0-linux.2", "1.139.0", "package.json", 3),
    /package revision/,
  );
  for (const revision of [
    0,
    -1,
    1.5,
    "02",
    "2\n",
    "2;echo bad",
    Number.MAX_SAFE_INTEGER + 1,
    null,
  ]) {
    assert.throws(() => validateRevision(revision), /positive integer/);
  }
  for (const tag of ["v1.139.0-linux.1", "v1.139.0-linux.0", "v1.139.0-linux.02"]) {
    assert.throws(() => releaseIdentity(tag));
  }
  assert.equal(parseOptions(["--revision", "2"]).revision, 2);
  assert.throws(() => parseOptions(["--revision", "0"]), /positive integer/);
});
test("stable Linux revisions publish as stable releases, while upstream previews remain prereleases", () => {
  for (const version of ["1.139.0", "1.140.0-beta.1"]) {
    const [create, publish] = releaseCommands(
      releaseTag(version, 2),
      {
        version,
        revision: 2,
        assets: [{ name: artifactNames(version, "x64", 2).rpm }],
      },
      "/release",
      "/release/notes.md",
    );
    assert.equal(create.includes("--prerelease"), version.includes("beta"));
    assert.ok(publish.includes(`--latest=${!version.includes("beta")}`));
  }
});
test("publishing an older upstream version or Linux revision does not replace the latest release", () => {
  assert.equal(shouldMarkLatest("v1.139.0-linux.2", { tag_name: "v1.139.0" }), true);
  assert.equal(shouldMarkLatest("v1.139.0-linux.3", { tag_name: "v1.139.0-linux.2" }), true);
  assert.equal(shouldMarkLatest("v1.139.0-linux.2", { tag_name: "v1.139.0-linux.3" }), false);
  assert.equal(shouldMarkLatest("v1.139.0-linux.99", { tag_name: "v1.140.0" }), false);
  assert.equal(shouldMarkLatest("v1.140.0", { tag_name: "v1.139.0-linux.99" }), true);
  assert.equal(shouldMarkLatest("v1.140.0-beta.1-linux.2", null), false);
  const [, publish] = releaseCommands(
    "v1.139.0-linux.2",
    {
      version: "1.139.0",
      revision: 2,
      assets: [{ name: artifactNames("1.139.0", "x64", 2).rpm }],
    },
    "/release",
    "/release/notes.md",
    { makeLatest: false },
  );
  assert.ok(publish.includes("--latest=false"));
});
test("releases upload assets to a verified tag before publishing and mark prereleases", () => {
  for (const version of ["1.0.0", "1.1.0-beta.1"]) {
    const [create, publish] = releaseCommands(
      `v${version}`,
      {
        version,
        assets: [{ name: artifactNames(version, "x64").rpm }],
      },
      "/release",
      "/release/notes.md",
    );
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
    existingRelease: draft,
    resumeDraft: true,
  });
  assert.deepEqual(upload.slice(0, 3), ["release", "upload", "v1.139.0"]);
  assert.ok(upload.includes("--clobber"));
  assert.ok(publish.includes("--draft=false"));
  assert.throws(
    () =>
      releaseCommands("v1.139.0", metadata, "/release", "/release/notes.md", {
        existingRelease: { ...draft, draft: false },
        resumeDraft: true,
      }),
    /already published/,
  );
  assert.throws(
    () =>
      releaseCommands("v1.139.0", metadata, "/release", "/release/notes.md", {
        existingRelease: draft,
      }),
    /Cannot resume/,
  );
});
test("release metadata records upstream versions and rejects modified artifacts or checksums", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "norc-release-test-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = path.join(output, "release");
  await mkdir(directory);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0",
    electronVersion: "41.5.0",
    dmgSha256: "a".repeat(64),
  });
  const name = artifactNames("1.139.0", "x64").rpm;
  await writeFile(path.join(directory, name), "test-package");
  await writeReleaseMetadata({ output, version: "1.139.0", arch: "x64", targets: ["rpm"] });
  const metadata = await verifyRelease(directory, "1.139.0");
  assert.equal(metadata.upstream.version, "1.139.0");
  assert.equal(metadata.assets.length, 1);
  await writeJson(path.join(directory, "build-info.json"), {
    ...metadata,
    upstream: { ...metadata.upstream, version: "1.140.0" },
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
test("patch release metadata and assets must match the exact package revision", async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "norc-patch-release-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = path.join(output, "release");
  await mkdir(directory);
  await writeJson(path.join(output, ".norc-upstream.json"), {
    version: "1.139.0",
    electronVersion: "41.5.0",
  });
  const name = artifactNames("1.139.0", "x64", 2).rpm;
  await writeFile(path.join(directory, name), "revision-two-package");
  await writeReleaseMetadata({
    output,
    version: "1.139.0",
    revision: 2,
    arch: "x64",
    targets: ["rpm"],
  });
  const metadata = await verifyRelease(directory, "1.139.0", 2);
  assert.equal(metadata.revision, 2);
  assert.equal(metadata.version, "1.139.0");
  assert.equal(metadata.assets[0].name, name);
  await assert.rejects(verifyRelease(directory, "1.139.0", 1), /package revision/);
  assert.throws(
    () => releaseCommands("v1.139.0", metadata, directory, "notes.md"),
    /package revision/,
  );
});
