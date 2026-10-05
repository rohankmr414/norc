These PNG icons are copied unchanged from Notion Calendar's official app bundle.
`upstream.json` records the upstream version, DMG checksum, and icon checksums.

Refresh them after extracting a new bundle:

```sh
npm run extract -- --output out-new
npm run icons:sync -- --output out-new
```

The automatic release workflow refreshes this set for every new upstream version.
Packaged apps always use the icons extracted from their own upstream bundle.
