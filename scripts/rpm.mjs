import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./common.mjs";

const templates = path.join(ROOT, "node_modules/app-builder-lib/templates/linux");

function render(template) {
  const variables = { executable: "norc", sanitizedProductName: "Norc" };
  return template.replace(/\$\{([a-zA-Z]+)\}/g, (match, name) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Unknown RPM script variable: ${name}`);
    return variables[name];
  });
}

export async function prepareRpmScripts(output) {
  // Reuse the pinned builder's integration scripts, including its sandbox and
  // AppArmor handling, rather than maintaining a separate copy.
  const [install, remove] = await Promise.all([
    readFile(path.join(templates, "after-install.tpl"), "utf8"),
    readFile(path.join(templates, "after-remove.tpl"), "utf8"),
  ]);
  const directory = path.join(output, ".norc-rpm");
  const afterRemove = path.join(directory, "after-remove.sh");
  const postTransaction = path.join(directory, "post-transaction.sh");
  const removal = render(remove).replace(/^#![^\n]*\n/, "");
  const guardedRemoval = `#!/bin/bash
# RPM passes the number of package instances remaining after removal.
# Upgrades/reinstalls retain an instance; only final removal cleans up.
if [ "\${1:-}" != "0" ]; then
  exit 0
fi
${removal}
`;
  const repair = render(install).replace(/^#![^\n]*\n/, "");
  const postTransactionScript = `#!/bin/bash
# Older Norc packages remove the command link and AppArmor profile in their
# postun even during upgrades. Restore integration after that cleanup runs.
${repair}
`;
  await mkdir(directory, { recursive: true });
  await writeFile(afterRemove, guardedRemoval);
  await writeFile(postTransaction, postTransactionScript);
  return { afterRemove, fpm: ["--rpm-posttrans", postTransaction] };
}
