import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DOWNLOAD_URL = "https://www.notion.com/calendar/desktop/mac-universal/download";
export const TARGETS = ["deb", "pacman", "rpm"];
export const ARCHITECTURES = {
  x64: { deb: "amd64", rpm: "x86_64", pacman: "x86_64" },
  arm64: { deb: "arm64", rpm: "aarch64", pacman: "aarch64" },
};

export async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}
export async function writeJson(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}
export async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
export function validateVersion(version) {
  if (semver.valid(version) !== version || semver.parse(version)?.build.length) {
    throw new Error(
      `Expected a SemVer version without build metadata, got ${JSON.stringify(version)}`,
    );
  }
  return version;
}
export function validateArchitecture(arch) {
  if (!Object.hasOwn(ARCHITECTURES, arch))
    throw new Error(`Unsupported architecture: ${arch}; use x64 or arm64`);
  return arch;
}
export function artifactNames(version, arch) {
  validateVersion(version);
  const architectures = ARCHITECTURES[validateArchitecture(arch)];
  // Match electron-builder's distro-specific version normalization.
  const nativeVersion = version.replaceAll("-", "~");
  const pacmanVersion = version.replaceAll("-", "_");
  return {
    deb: `norc_${nativeVersion}-1_${architectures.deb}.deb`,
    rpm: `norc-${nativeVersion}-1.${architectures.rpm}.rpm`,
    pacman: `norc-${pacmanVersion}-1-${architectures.pacman}.pkg.tar.xz`,
  };
}
export async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || `exit ${code}`})`));
    });
  });
}
export function parseOptions(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      dmg: { type: "string" },
      url: { type: "string", default: DOWNLOAD_URL },
      output: { type: "string", default: path.join(ROOT, "out") },
      arch: { type: "string", default: "x64" },
      x64: { type: "boolean" },
      arm64: { type: "boolean" },
      reuse: { type: "boolean", default: false },
      "electron-dist": { type: "string" },
      help: { type: "boolean" },
      "release-tag": { type: "string" },
    },
  });
  if (values.x64 && values.arm64) throw new Error("Choose one architecture per build");
  values.arch = values.arm64 ? "arm64" : values.x64 ? "x64" : values.arch;
  validateArchitecture(values.arch);
  values.output = path.resolve(values.output);
  return { ...values, targets: positionals.length ? positionals : TARGETS };
}
export function cli(moduleUrl, operation) {
  if (process.argv[1] && moduleUrl === pathToFileURL(path.resolve(process.argv[1])).href) {
    operation().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
