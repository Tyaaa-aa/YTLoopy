# Versioning and keeping people's data

YTLoopy keeps everything in `chrome.storage.local`, which Chrome stores **per extension ID**.
Two things protect that data across releases.

## 1. A fixed extension ID

An unpacked extension normally gets its ID from the folder it's loaded from, so loading a new
version from a new folder gives it a new, empty storage. `manifest.json` therefore has a `key`
(a public key), which pins the ID to `ejkjbfkhfckapbfoblffdidpcemoifkj` wherever the folder lives.

- Never change or remove `key`. Doing so changes the ID and strands everyone's library.
- The matching private key is only needed to pack a `.crx`. It is not in this repository.
- Data is still deleted if the extension is **removed** in `chrome://extensions`; that's Chrome's
  behaviour for every extension. Updating means replacing the files and pressing reload.
- The Chrome Web Store ignores `key` and assigns its own ID, so a store install starts with an empty
  library. Export / import moves a library across.

## 2. A schema version with migrations

Stored data carries `schemaVersion` (`src/shared/migrations.js` → `SCHEMA_VERSION`). On install,
update and browser start the background worker runs `ensureSchema()`, which:

1. reads the stored version (1.0.x stored none: that's schema 1),
2. if it's older, saves an untouched copy under `backup:schema<old>`,
3. runs each migration step in order and writes the result with the new `schemaVersion`.

Data from a **newer** schema (someone went back to an older build) is left alone.

Export files carry the same number in `version` (plus `appVersion` for information). Import runs the
same migration steps on older files and refuses files from a newer schema with a clear message, so a
backup made with any version imports into any later one.

## Adding a feature that changes stored data

| Change | What to do |
| --- | --- |
| New optional setting | Add it to `DEFAULT_SETTINGS`. `withDefaults()` fills it in. No migration. |
| New optional field on a section / marker / video | Read it with a fallback, and keep it in `sanitizeVideo()` so import doesn't drop it. No migration needed unless old records need a computed value. |
| Rename, restructure or compute fields | Bump `SCHEMA_VERSION`, append `{ to, describe, run }` to `MIGRATIONS`, add a test in `tests/migrations.test.js`. |

Rules for a migration step:

- It receives the whole storage object (`{ settings, 'video:<id>': {...} }`) and returns the new one.
- Only add or transform. Never drop keys or fields the step doesn't understand.
- Use `mapVideos()` for per-video changes.
- Steps are permanent: never edit or reorder one that has shipped.

## Releasing

1. Bump `version` in `manifest.json` and `package.json` (semver: patch = fixes, minor = features).
2. `npm test`, then `npm run package` → `dist/ytloopy-<version>.zip`.
3. Create a GitHub release with the zip attached.
