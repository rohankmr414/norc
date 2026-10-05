# Norc

![Notion Calendar icon](icons/icon_128x128.png)

Norc is an unofficial Linux desktop app for **Notion Calendar (formerly Cron)**.
It repackages the official app with Linux support and its matching Electron version.
This project is independent of Notion.

## Install

Download a package from the [latest release](https://github.com/rohankmr414/norc/releases/latest),
then install it from your downloads directory:

| Distribution | Command |
| --- | --- |
| Fedora | `sudo dnf install ./norc-*.rpm` |
| Debian / Ubuntu | `sudo apt install ./norc_*.deb` |
| Arch Linux | `sudo pacman -U ./norc-*.pkg.tar.xz` |

Launch **Norc** from your application menu or run `norc`.
Browser sign-in requires an installed package; launching the unpacked app alone
does not register the `cron://` callback. If your browser cannot return to Norc, run:

```sh
xdg-mime default norc.desktop x-scheme-handler/cron
```

Quit any unpacked instance and launch the installed app before retrying.
Updates are delivered through new Linux packages.

## Build and test

Requires Linux, Node.js 22.12+, npm, and 7-Zip with DMG/HFS support (`7zz` or `7z`).
RPM builds also need `rpmbuild`; Pacman builds need `bsdtar`.

```sh
# Fedora
sudo dnf install nodejs npm 7zip rpm-build bsdtar libxcrypt-compat

# Ubuntu (install Node.js 22.12+ and npm separately)
sudo apt-get update
sudo apt-get install -y 7zip rpm libarchive-tools
```

From the repository:

```sh
npm ci
npm test
npm run build
```

Packages, `SHA256SUMS`, and `build-info.json` are written to `out/release/`.
For an RPM only, use `npm run build:rpm`. Builds default to `x64` (x86-64);
pass `-- --arch arm64` for ARM64. CI builds x86-64 packages.

For another build, use `-- --reuse` to reuse the extracted app or
`-- --output out-new` to download a fresh bundle. Install the resulting package
to test browser sign-in locally.

## Releases

Package versions and tags mirror upstream: Notion Calendar `1.139.0` produces
Norc `1.139.0` with tag `v1.139.0`.

The [upstream workflow](.github/workflows/upstream.yml) checks every six hours
and can also run manually. For a new version, it refreshes the icons, runs tests,
builds RPM, DEB, and Pacman packages, and publishes the matching release with
checksums and build metadata. It uses `GITHUB_TOKEN` and never overwrites a
published release.

The [build workflow](.github/workflows/build.yml) runs for branch pushes and pull
requests, skipping Markdown-only changes. Manual runs remain available.
Pushing a `v<version>` tag also publishes a release; the tag must match both
`package.json` and the downloaded upstream version.

To check upstream without publishing:

```sh
npm run upstream:check -- --repo rohankmr414/norc
```
