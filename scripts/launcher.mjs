import { open, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Ozone selects the display backend before Electron loads application JavaScript.
// Use a launcher so the flag reaches the browser process during initialization.
export const LAUNCHER = `#!/bin/sh
norc_path=$(readlink -f -- "$0") || exit 1
norc_dir=$(dirname -- "$norc_path")
for norc_arg in "$@"; do
  case "$norc_arg" in
    --) break ;;
    --ozone-platform|--ozone-platform=*)
      exec "$norc_dir/norc-bin" "$@"
      ;;
  esac
done
exec "$norc_dir/norc-bin" --ozone-platform=x11 "$@"
`;

export async function installLauncher(appOutDir) {
  const executable = path.join(appOutDir, "norc");
  const handle = await open(executable, "r");
  const magic = Buffer.alloc(4);
  try { await handle.read(magic, 0, magic.length, 0); }
  finally { await handle.close(); }
  if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error("Expected the Norc ELF executable before installing its launcher");
  }
  await rename(executable, path.join(appOutDir, "norc-bin"));
  await writeFile(executable, LAUNCHER, { mode: 0o755 });
}

export default async function afterPack({ appOutDir, electronPlatformName }) {
  if (electronPlatformName === "linux") await installLauncher(appOutDir);
}
