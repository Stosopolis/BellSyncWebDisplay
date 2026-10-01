# BellSync Display Web

A local-first, dependency-free classroom Display client. It runs entirely in a current browser with JavaScript enabled: no account, API, Node package, or backend is required.

## Run locally

```sh
cd BellSyncWebDisplay
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080). Serving through HTTP is required because the WMHS built-in resource files are loaded with `fetch`.

## Set up a browser schedule

Choose **Enter My Schedule** on the first screen to create a browser-local school schedule. It starts with editable example bell-time rows, so teachers do not begin with a blank page:

1. Name the school and set its IANA time zone.
2. Choose Same Every Day, Day 1–5, Day 1–6, Day 1–7, A/B, A–G, or a custom comma-separated rotation.
3. Add, rename, reorder, or remove periods and set their bell times.
4. Enter personal class names and rooms separately for every rotation day.
5. Set a rotation seed date/day and mark no-school dates. Rotation advances only across weekdays that are not marked no-school.
6. Save. The live classroom Display opens immediately.

**Edit Schedule** returns to the same teacher-friendly working-copy editor for browser-created schedules. WMHS native imports instead open a protected personal-class editor: display name, existing class names, and rooms can change, while imported period/day IDs, all bell templates, calendar data, blocks, and lunch selections remain intact. Reimport from BellSync to change those source-managed values. Cancelling leaves the active local schedule unchanged; saving validates and atomically replaces it. The browser stores each saved profile in `localStorage`, so reopening the page returns to the last selection.

## Upload, import, and export

**Upload My Schedule** is shown honestly as coming soon. Browser-only PDF/photo recognition would require a local PDF renderer and OCR implementation or a processing service; neither has been added to this dependency-free client.


- **Import from BellSync** is the quickest option for teachers already using BellSync on their phone. It imports single `.bellsync` v1 *WMHS* personal schedules or native version 1 schedule bundles and combines supported entries with the bundled public WMHS calendar and bell data. An import review lists entries that cannot be supported.
- **Export Display Schedule** downloads a browser-native `.bellsyncdisplay` JSON backup. It includes the browser school structure, rotation/calendar settings, personal assignments, and display preferences.
- **Import Display Schedule** adds a `.bellsyncdisplay` backup on another browser/computer after validating the configuration. It also accepts the versioned Export All backup; existing profiles are kept.

The browser-native format is intentionally separate from `.bellsync`; it does not redefine the native BellSync sharing format. GMS and custom-school `.bellsync` files lack the school-owned definitions needed by this static browser client, so they are not claimed as supported by the native import path.

## Display settings

**Display Settings** keeps classroom presentation preferences separate from schedule editing:

- accent color
- 12/24-hour clock
- show/hide rooms
- show/hide Today’s Schedule
- show/hide school name
- compact, standard, or large display size

All preferences are local to this browser.

## Demo

**Try Demo** loads a development/testing schedule into the current page. Demo Classroom is always available under **Change Schedule**. Its configuration is never written to local storage unless you explicitly choose **Save as New Schedule** or **Save Demo as New Schedule**. Normal switching stores only the Demo selection marker.

## Deploy to GitHub Pages

There is no build step. This folder is ready to publish as a static site: it uses only relative paths, browser `localStorage`, and bundled JSON resources. The included `.nojekyll` file keeps GitHub Pages from applying Jekyll processing.

1. Put `BellSyncWebDisplay/` in a GitHub repository.
2. In **Settings → Pages**, publish from the branch/folder that contains this `index.html`.
3. Open the GitHub Pages URL, including its repository subpath when applicable, such as `https://username.github.io/BellSyncWebDisplay/`.

To use the intended custom domain later, add `display.bellsync.app` in GitHub Pages and create the DNS record GitHub provides. Keep the included `.nojekyll` file at the published root. No server configuration, secret, API key, or machine-specific path is required.

Before publishing, test locally:

```sh
cd BellSyncWebDisplay
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). Serving through HTTP is required because the bundled WMHS resources are loaded with `fetch`.

## Phase 1 reliability checks

Run the dependency-free deterministic checks with a current Node.js runtime:

```sh
node tests/phase1.mjs
node --check app.js
node --check display-core.mjs
```

No npm install or browser is required. Checks cover configuration/import validation, exclusions, rotations, chronological runtime ordering, overlap rejection, clock formats, display fallbacks, safe output encoding, WMHS preservation, and the included demo.

Configuration schema versions 1 and 2 and Display backup format version 1 are supported. Known template-only configurations are migrated explicitly; malformed objects, unknown versions, invalid dates/times/IDs, unknown assignment keys, and overlapping periods are rejected before replacing browser storage. Runtime events are sorted chronologically without changing editor row order. Browser-created schedules currently use one regular bell template.

The bundled WMHS June 17, 2027 entry uses early-release bells. Its known delayed-start date has no authoritative bell template and shows **Bell Times Unavailable** rather than regular bells. Existing browser backups retain their embedded calendar; reimport a native WMHS schedule to load updated bundled school data.

Demo display settings stay in memory. Only saving the demo through Edit Schedule persists it. Phase 1 did not add pre-school thresholds, passing/gap states, or lunch splitting; these are implemented by Phase 2 below.

## Phase 2 schedule presentation

The pure timeline generator in `display-core.mjs` and resolver in `schedule-presentation.mjs` supply one effective timeline to both the dashboard and Today’s Schedule. Run the additional checks with:

```sh
node tests/phase2.mjs
node --check schedule-presentation.mjs
```

- **Upcoming:** earlier than 30 minutes before the first meaningful activity, show its name and start time with no live countdown.
- **Before School:** begins exactly 30 minutes before that activity; counts down to its start.
- **Now:** an active activity counts down to its end.
- **Passing Time:** only explicit passing rows or published adjacent WMHS bell boundaries qualify. Published boundaries must meet both effective activities; missing assignments cannot stretch passing across an open period.
- **Up Next:** an ordinary gap counts down to the next meaningful activity without keeping the previous class active.
- **Done for Today:** at the final meaningful activity’s end, clear the countdown, current activity, and Next card.

Academic rows with missing or blank personal class names represent open time and are omitted from the effective timeline. Lunch, FLEX, advisory/support, and other explicitly scheduled activities can display without a personal class name. Manual schedule gaps remain neutral; choose **Passing Time** as the period type to enter an authoritative transition explicitly. Orphan transition rows with no activity at their end are omitted.

WMHS imports respect L1/L2/L3 selections and published regular/FLEX lunch rules. The effective timeline splits the block into class-before, any published passing-to-lunch interval, Lunch, and class-after, omitting zero-length segments. Lunch has its own countdown and no borrowed class room. Missing selections and early-release templates do not invent lunch timing. Lunch-duty focus and native personal activity-name overrides are not implemented.

No-school dates, weekends, and missing/expired WMHS calendar dates cannot show live school states. Delayed-start dates without authoritative bells remain **Bell Times Unavailable**. The resolver supports static past/future-date previews internally; no date-picker UI was added.

Phase 2 does not change the storage key, backup format, or configuration schema. Existing schema 1/2 data still loads through Phase 1 validation. Generated events and presentation states are not persisted, and protected WMHS editing continues to preserve all source-managed data.

## Phase 3 browser profiles

**Change Schedule** opens a picker containing Demo Classroom, all saved profiles, and Add / Import Schedule. Each profile shows its name and school, with the active choice marked. Open, Rename, and Remove affect only that profile. Removal asks for confirmation; removing the active profile selects another saved profile if available and returns to the picker.

The versioned store is `bellsync.webDisplay.profiles.v1` with `schemaVersion: 1`, `activeProfileID`, `lastRealProfileID`, and `savedProfiles: [{id, configuration}]`. IDs are random UUIDs independent of school IDs. The reserved `demo` selection has no stored configuration. Demo preferences and edits stay temporary until explicitly saved as a new profile. Leaving Demo returns to the last real profile when available.

On first load, an existing `bellsync.webDisplay.config.v1` configuration is validated and migrated into one active profile. The legacy key is retained unchanged as a recovery copy. Once the new collection exists, the legacy key is no longer read—even after all profiles are removed—so deleted schedules are not resurrected. If reading, validation, or migration fails, the UI reports it and preserves the original data; saves/imports stay blocked until the storage problem is resolved. Each profile mutation is validated and saved in one write. A stale tab must reload before it can overwrite a collection changed by another tab.

Native bundle support follows `BellSyncScheduleBundle` in native `Sources/BellSyncConfiguration.swift`: `{bundleFormatVersion: 1, schedules: [BellSyncSharedSchedule], createdAt}`. Only the contract was inspected; native files were not changed. The synthetic fixture in `tests/fixtures/native-bundle-v1.json` contains no personal data.

Imports show a review before writing anything. Names can be edited there; unnamed single exports receive an editable suggestion. A single imported profile becomes active. Multiple imports keep the current selection and open the picker so you can choose. Supported WMHS entries preserve names, assignments, rooms, lunch choices, source calendar/templates, and available source-version/notes/export-time metadata.

Other schools, unknown schedule versions, embedded school definitions, date-specific schedules, personal activity-name overrides, personal block colors, and school-wide schedule mode are reported as unsupported rather than being silently approximated. Supported entries may be added after reviewing the skipped entries. Malformed bundle envelopes or malformed supported schedule data abort the import without adding any profiles.

**Export Display Schedule** still exports the active configuration in the original single-profile format. **Export All Display Schedules** in the picker exports all real profiles with format `bellsync-display-profiles`, version 1. Importing it validates the entire collection and adds profiles with new IDs; it never replaces the existing collection. A Demo selection marker may be present in the backup, but its temporary configuration is excluded.

Run all deterministic checks without a browser or npm dependencies:

```sh
node tests/phase1.mjs
node tests/phase2.mjs
node tests/phase3.mjs
```
