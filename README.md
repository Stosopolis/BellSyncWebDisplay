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

**Edit Schedule** returns to the same teacher-friendly working-copy editor for browser-created schedules. WMHS native imports instead open a protected personal-class editor: display name, existing class names, rooms, and lunch selections can change, while imported period/day IDs, all bell templates, calendar data, and blocks remain intact. Reimport from BellSync to change source structure or timing. The Edit button resolves the saved active profile by ID; Demo uses a separate temporary editor, and Add Schedule uses creation mode. Cancelling leaves the active local schedule unchanged; saving validates and atomically replaces it. The browser stores each saved profile in `localStorage`, so reopening the page returns to the last selection.

## Upload, import, and export

**Upload My Schedule** is shown honestly as coming soon. Browser-only PDF/photo recognition would require a local PDF renderer and OCR implementation or a processing service; neither has been added to this dependency-free client.


- **Import from BellSync** is the quickest option for teachers already using BellSync on their phone. It imports single `.bellsync` v1/v2 *WMHS* schedules or native version 1 schedule bundles containing supported v1/v2 entries and combines supported entries with the bundled public WMHS calendar and bell data. An import review lists entries that cannot be supported.
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

**Try Demo** loads a development/testing schedule into the current page. Demo Classroom is always available under **Change Schedule**. Its configuration is never written to local storage unless you explicitly choose **Save Demo as New Schedule** in the picker. **Apply Demo Changes** changes the temporary Demo only. Normal switching stores only the Demo selection marker.

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

Demo display settings stay in memory. Applying edits through Edit Schedule stays temporary; use the explicit picker copy action to save a real profile. Phase 1 did not add pre-school thresholds, passing/gap states, or lunch splitting; these are implemented by Phase 2 below.

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

WMHS imports respect L1/L2/L3 selections and published regular/FLEX lunch rules. The effective timeline splits the block into class-before, any published passing-to-lunch interval, Lunch, and class-after, omitting zero-length segments. Lunch has its own countdown and no borrowed class room. Missing selections and early-release templates do not invent lunch timing. Lunch-duty focus is not implemented. Native v2 WMHS activity-name overrides are applied by exact source address without changing timing.

No-school dates, weekends, and missing/expired WMHS calendar dates cannot show live school states. Delayed-start dates without authoritative bells remain **Bell Times Unavailable**. The resolver supports static past/future-date previews internally; no date-picker UI was added.

Phase 2 does not change the storage key, backup format, or configuration schema. Existing schema 1/2 data still loads through Phase 1 validation. Generated events and presentation states are not persisted, and protected WMHS editing continues to preserve all source-managed data.

## Phase 3 browser profiles

**Change Schedule** opens a picker containing Demo Classroom, all saved profiles, and Add / Import Schedule. Each profile shows its name and school, with the active choice marked. Open, Rename, and Remove affect only that profile. Removal asks for confirmation; removing the active profile selects another saved profile if available and returns to the picker.

The versioned store is `bellsync.webDisplay.profiles.v1` with `schemaVersion: 1`, `activeProfileID`, `lastRealProfileID`, and `savedProfiles: [{id, configuration}]`. IDs are random UUIDs independent of school IDs. The reserved `demo` selection has no stored configuration. Demo preferences and edits stay temporary until explicitly saved as a new profile. Leaving Demo returns to the last real profile when available.

On first load, an existing `bellsync.webDisplay.config.v1` configuration is validated and migrated into one active profile. The legacy key is retained unchanged as a recovery copy. Once the new collection exists, the legacy key is no longer read—even after all profiles are removed—so deleted schedules are not resurrected. If reading, validation, or migration fails, the UI reports it and preserves the original data; saves/imports stay blocked until the storage problem is resolved. Each profile mutation is validated and saved in one write. A stale tab must reload before it can overwrite a collection changed by another tab.

Native bundle support follows `BellSyncScheduleBundle` in native `Sources/BellSyncConfiguration.swift`: `{bundleFormatVersion: 1, schedules: [BellSyncSharedSchedule], createdAt}`. Only the contract was inspected; native files were not changed. The synthetic fixture in `tests/fixtures/native-bundle-v1.json` contains no personal data.

Imports show a review before writing anything. Names can be edited there; unnamed single exports receive an editable suggestion. A single imported profile becomes active. Multiple imports keep the current selection and open the picker so you can choose. Supported WMHS entries preserve names, assignments, rooms, lunch choices, source calendar/templates, and available source-version/notes/export-time metadata.

Other schools, unknown schedule versions, and embedded school definitions are reported as unsupported. V1 optional-feature handling is unchanged. V2 uses an explicit adapter: it preserves native source metadata and supported WMHS activity-name overrides, retains display-only unsupported data with review notes, and supports explicit school-wide mode using published assignments plus profile overlays. Shared dates are retained as native metadata. Nonempty Personal Activities and school-definition snapshots are not substituted with bundled timing; profiles requiring those structures are clearly reported as unsupported. Supported entries may be added after reviewing the skipped entries. Malformed bundle envelopes or malformed supported schedule data abort the import without adding any profiles.

**Export Display Schedule** still exports the active configuration in the original single-profile format. **Export All Display Schedules** in the picker exports all real profiles with format `bellsync-display-profiles`, version 1. Importing it validates the entire collection and adds profiles with new IDs; it never replaces the existing collection. A Demo selection marker may be present in the backup, but its temporary configuration is excluded.

Run all deterministic checks without a browser or npm dependencies:

```sh
node tests/phase1.mjs
node tests/phase2.mjs
node tests/phase3.mjs
```

## Current v2 compatibility and editor checks

The v2 schema was inspected read-only in native `BellSyncSharedSchedule`, `ActivitySourceAddress`, and `ProfilePersonalActivity`. V2 adds optional effective school-definition snapshots and private activities; built-in classic WMHS exports normally have no snapshot. Both native versions normalize to the same managed-WMHS profile type, with the actual v2 version and original payload retained in native metadata. Local class-name edits replace matching imported classroom-name overrides for that profile only.

Run all deterministic suites without launching a browser:

```sh
node tests/phase1.mjs
node tests/phase2.mjs
node tests/phase3.mjs
node tests/wmhs-lunch.mjs
node tests/schedule-labels.mjs
node tests/dashboard-ui.mjs
node tests/native-v2.mjs
node tests/editor-routing.mjs
```


## Built-in Doyle PreK schedules

Choose **Doyle School** in setup (or Add Schedule), then **Doyle PreK A–I**.
Selecting a letter opens a normal-day schedule preview with activity times and
confirmed bathroom point reminders. Choose **Use This Schedule** to open/save
it, or **Back to Doyle Schedules** to compare another letter. No import or manual
schedule entry is required. From a Doyle dashboard, **Schedule → Switch Schedule
→ Change Doyle Schedule** returns to the picker while keeping all saved profiles
available. A–I are neutral source-column identities, not
teacher names or official room numbers. Returning to the same built-in choice
reuses its saved snapshot and retains browser-local edits/settings.

Append `?school=doyle` to the published Web Display root URL to open the picker.
Append `?school=doyle&profile=A` for a direct classroom link; replace A with any
letter through I. These links contain no teacher names or profile IDs. They do
not overwrite other saved profiles. An invalid classroom value opens the picker.
These entry points become public when this revision is published; adding them
locally does not publish or deploy the site.

`public/builtins/doyle/prek-a.json` through `prek-i.json` were generated by the
native `BellSyncSharedSchedule` exporter from
`BuiltInSchoolDefinitions.doyleClassrooms` (2026–2027.1), using
`tests/fixtures/doyle-fixture-export.swift`. The existing portable-v2 resolver
handles their frozen snapshots without another schedule/calendar engine.
Confirmed bathroom reminders appear chronologically as point reminders in the
schedule list; they never split or replace the classroom countdown. Undated
KidzFun events are excluded. The published Wakefield PreK–8 calendar is retained;
early-release times remain unavailable, the malformed 1:00–1:05 PM source
interval stays blank, and dates outside the supplied year are not invented.

To refresh the assets from reviewed native definitions, copy the fixture driver
to a temporary `main.swift`, then compile it with the same native source inputs
as the Canterbury fixture: ScheduleEngine, BellSyncConfiguration,
BellSyncSchoolDefinition, SchoolCalendarCorrections, AssignmentDraft, and
FaceVariant (`-D DEBUG`). Run the resulting exporter with the output directory
`public/builtins/doyle` and parity output file
`tests/fixtures/doyle-native-days.json`. Native files are read only. Run
`node tests/doyle.mjs` and all existing suites before publishing refreshed data.
There is no production build step: this project serves its static modules/assets.

Live dashboard updates keep the header and BellSync branding image mounted.
Only clock/date/fullscreen text and dynamic cards update; the schedule scroller
continues to retain its position during countdown ticks.

## Local timing and additional built-in schools

Imported snapshot and WMHS/Galvin editors include **Timing overrides**. Optional
start/end fields override a duration activity; point reminders have one time
field. Blank fields use the source. **Reset to Source** clears only timing.
Invalid effective intervals are rejected before saving. Overrides are stored on
the individual profile, included in Display backups, and applied before timeline
resolution; native source snapshots are retained unchanged. All saved profiles can also use **Schedule → Timing Overrides**, including
manual schedules. Manual schedules retain their directly editable bell-time
controls; optional overlays keep the saved source bells intact until reset.

Woodville (22 profiles), Ferryway (one four-day school schedule), and Walton
(10 current classroom profiles) use the same picker → preview → Use This Schedule
flow as Doyle. Preview day controls show weekday/rotation variations. General
links use `?school=woodville`, `?school=ferryway`, or `?school=walton`. Direct links
add `&profile=<code>` using a code from the school's `profiles.json`; codes are
case insensitive. Examples: `&profile=pksw`, `&profile=ferryway`, `&profile=kg`.
Switch Schedule retains all browser profiles and offers Change [School] Schedule.

The source is the registered native `BuiltInSchoolDefinitions` entries and
`BellSyncSharedSchedule` exporter, captured by
`tests/fixtures/builtin-schools-export.swift`. Woodville is 2026–2027.1. Walton's
current Master Schedules 2026–27 source includes versioned kindergarten/Grade 1
reviews and explicit Wakefield PreK–8 dates; it is not old custom-test data.
Ferryway retains its native rotation anchor, calendar exceptions, and timings.
Run the exporter with the public builtins directory and parity fixture output
path after compiling it as a temporary main.swift with the same read-only native
inputs used for the Doyle exporter. Native parity fixtures cover September 2,
2026 through June 22, 2027; this test window does not invent calendar year bounds.

Missing early-release times remain unavailable. Walton's kindergarten revisions
with an unconfirmed end retain known activities and display timing unavailable
after them; no completion or school-day progress is invented. Public activity
names omit the technical suffix “(confirmed portion)” when it comes from the
source; source fields and exact confirmed intervals remain intact in the editor
and backups. Explicit custom display names are preserved.

## Contact Support

Contact Support opens `https://bellsync.app/support` in a new browser tab. It is
available in the main Schedule menu, initial setup, and shared dialog footer
(including school pickers/previews, saved schedules, settings, and all editors).
The link has no save, profile-switch, or fullscreen handler. Browser-native
navigation does not rewrite the current display configuration.
