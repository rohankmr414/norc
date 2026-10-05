# Norc

![Notion Calendar icon](icons/icon_128x128.png)

Norc is an unofficial Notion Calendar desktop app for Linux. It repackages the
latest official macOS universal bundle, installs its dependencies for Linux,
and uses the same Electron version as the official app. Cron is now Notion
Calendar; the Linux app, executable and package retain the **Norc** name.

Download **RPM**, **DEB**, or **Pacman** packages from the
[latest release](https://github.com/rohankmr414/norc/releases/latest).
This project is independent of Notion. See
[Notion's supported platforms](https://www.notion.com/help/notion-calendar-apps).

## Build

Requires Linux, Node.js 22.12+, npm, and current 7-Zip with DMG/HFS support
(`7zz` or `7z`). RPM builds require `rpmbuild`; Pacman builds require `bsdtar`.
All extraction, patching, packaging orchestration and release scripts use JavaScript.

On Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y 7zip rpm libarchive-tools
npm ci
npm run build
```

On Fedora, install build prerequisites with:

```sh
sudo dnf install nodejs npm 7zip rpm-build bsdtar libxcrypt-compat
```

The bundled packaging tool needs `libcrypt.so.1`, supplied by `libxcrypt-compat`.
For just an x86-64 RPM:

```sh
npm ci
npm run build:rpm -- --arch x64
```

`start.sh` remains a convenience wrapper around `npm ci` and the JavaScript build.
It accepts the same arguments, e.g. `./start.sh rpm --arch x64`.

Output for Notion Calendar 1.139.0:

```text
out/release/norc-1.139.0-1.x86_64.rpm
out/release/norc_1.139.0-1_amd64.deb
out/release/norc-1.139.0-1-x86_64.pkg.tar.xz
out/release/build-info.json
out/release/SHA256SUMS
```

Extraction refuses to overwrite an existing `out/`. Use `--output out-new` for
a fresh build or `--reuse` to patch and rebuild the existing extraction.
For example, reuse a previously downloaded official DMG:

```sh
npm run build -- rpm --dmg /path/to/notion-calendar.dmg --output out-new
```

Individual extraction and patching steps are also available:

```sh
npm run extract -- --dmg /path/to/notion-calendar.dmg
npm run patch
npm run build -- rpm --reuse
```

Run `npm start` inside `out/` to launch the extracted app. Run `npm test` in the
repository to verify migration, Linux callbacks, version checks, and release validation.
`--arch arm64` selects ARM64 packages; CI builds and verifies x86-64 packages.

Browser sign-in requires the `cron://` callback handler. Install a package using
the steps below before testing sign-in. Launching the unpacked binary or running
`npm start` alone does not install that handler.

## Install

On Fedora and other DNF-based distributions:

```sh
sudo dnf install ./out/release/norc-*.rpm
xdg-mime default norc.desktop x-scheme-handler/cron
xdg-mime query default x-scheme-handler/cron
```

The query should print `norc.desktop`. Quit any unpacked instance and launch the
installed app before retrying browser sign-in.

Launch **Norc** from your application menu or run `norc`. The package registers
`cron://`, which the current official app still uses for sign-in callbacks.
Callbacks wait until the sign-in or calendar view is ready; opening another
instance focuses the existing window.

The Linux build enables window controls and uses the supported Windows browser
identity while retaining the Electron bridge. Updates arrive through new Linux
packages; the upstream macOS/Windows updater is disabled. Configure autostart
through your desktop environment's startup settings.

To verify downloaded files, place the packages, `build-info.json` and
`SHA256SUMS` in one directory, then run `sha256sum -c SHA256SUMS` there.

## Releases

Norc mirrors **Notion Calendar's upstream version** for both package versions
and release tags: upstream `1.139.0` produces Norc `1.139.0` and tag
`v1.139.0`. The extracted official bundle is the source of truth; `package.json`
records the version intended for the next tagged release. Each build records
the Notion Calendar and Electron versions and the source DMG's SHA-256 in
`build-info.json`.

GitHub Actions builds packages on branch pushes, pull requests, and manual runs.
The [upstream update workflow](.github/workflows/upstream.yml) also checks the
official download every six hours, at 00:23, 06:23, 12:23 and 18:23 UTC. It can
be started manually from the Actions tab. If a version has no published release,
it downloads that exact bundle, refreshes the icons and package metadata, runs
tests, builds all three packages, and publishes the matching `v<version>` release.
Older upstream versions and versions already published are skipped.

Automatic releases use the repository's built-in `GITHUB_TOKEN`; no additional
token is needed. The workflow builds and publishes directly, since tags pushed
with this token [do not trigger another push workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow). A release commit
records the updated version and icons under its tag; the default branch is left
unchanged. Interrupted releases reuse the existing tag and can resume a draft.
Only unpublished draft assets may be replaced during recovery.

The [manual release workflow](.github/workflows/build.yml) also publishes on a
pushed `v<version>` tag matching both
`package.json` and the downloaded upstream bundle. A mismatched download fails
before packaging. For the initial 1.139.0 release, after committing the migration:

```sh
npm run release:check -- v1.139.0
git tag -a v1.139.0 -m "Norc v1.139.0"
git push origin HEAD
git push origin v1.139.0
```

For subsequent releases, build or extract the latest upstream bundle to read
its version from `out/.norc-upstream.json`. From a clean, committed working tree,
set that exact version (replace the example with the actual upstream version):

```sh
npm version 1.140.0
git push origin HEAD --follow-tags
```

If upstream supplies a prerelease version, use the same version and matching
`v` tag. CI marks prereleases accordingly and keeps
them out of the latest stable release. RPM/DEB prerelease versions use `~`;
Pacman uses `_`, matching the packaging tool's native version normalization.

Releases include generated change notes, all three package formats, checksums,
and build metadata. Assets upload to a draft before publication; published
releases are never overwritten. Upstream layout changes fail with an explicit
error before patching the app.

Check upstream without publishing anything:

```sh
npm run upstream:check -- --repo rohankmr414/norc
```

For a private repository, supply a token through `GH_TOKEN`.

The checked-in icons use the current Notion Calendar artwork. To refresh them
from an extracted bundle, run `npm run icons:sync -- --output out-new`.
