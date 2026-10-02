# Portable native v2 snapshots

Schema references inspected: native `Sources/BellSyncConfiguration.swift`
(`BellSyncSharedSchedule`, `genericAssignmentValidationError`),
`Sources/BellSyncSchoolDefinition.swift` (`BellSyncSchoolDefinition`,
`ProfilePersonalActivity`, `resolvedDay`), `Sources/ScheduleEngine.swift`
(`genericClassroomEvents`, `genericEvents`, `profileActivityEvents`, point and
workday boundary resolution), and the Mac importer in
`Sources/ConfigurationStore.swift` (`importSharedSchedule`). No native source
files were edited.

## Interchange contract

V1 contains assignments plus schedule/school names and source version metadata.
V2's current exporter also carries `schoolDefinitionSnapshot`,
`personalActivities`, `activityNameOverrides`, `personalBlockColors`,
`usesSchoolSchedule`, optional `sharedSchool`, `gmsGrade`, `date`, `notes`, and
`createdAt`. Assignment fields are `title`, `room`, `block`, and optional
`lunch`. A shared date is export metadata, not a replacement calendar.

The snapshot has schemaVersion 1, stable `id`, `contentVersion`, `displayName`,
`timeZoneIdentifier`, and:

- `cycle`: kind, arbitrary stable day IDs, optional names and rotation anchor.
- `periodDefinitions`: IDs, names, kinds and assignment eligibility.
- `scheduleTemplates`: stable item IDs, period IDs and start/end; optional
  `periodsByEffectiveDate` revisions and `unconfirmedEndFrom` policy.
- `calendarRule`: explicit dates or weekday cycle, school weekdays, default,
  weekday and cycle-day templates, fixed weekday day IDs, assignment layout.
- `calendarExceptions`: scheduled, noSchool or scheduleUnavailable; optional
  template/day IDs and note. Exceptions override repeating rules.
- Optional `lunchRules`, `specialSchedules`, `staffEvents`, `activityLayers`,
  `activityPresentation`, `scheduledPointEvents`, `blockColors`.

`activityLayers.personal` supplies default owner intervals; `.staff` is contextual.
Both use template-period records. `suppressedClassroomDates` suppresses named
source periods on exact dates. Profile `personalActivities` supply IDs, titles,
times, rooms, weekdays, day restrictions and optional `sourcePeriodID`. An
explicit empty array removes default owners; omission/null retains snapshot
defaults. No ownership is inferred from titles.

Activity-name overrides use an exact source address: schoolID, layer, dayID,
templateID, itemID, periodID. Points have stable ID, title, time, optional dates,
excluded dates, weekdays, category, alternative group and `endsWorkday`.
Optional fields and unknown harmless metadata are retained in the original file.

## Web adaptation

V1 and snapshot-free WMHS v2 keep their adapters. Self-contained v2 snapshots
produce schemaVersion 2 profiles with sourceKind `bellsync-snapshot` and
`portable.shared` holding the entire original interchange file. `portable.edits`
holds separate, validated display-name/room overrides. Built-in resources are
not fetched for snapshot-only imports. Snapshot identity wins even when its ID
matches a bundled school. Quick setup keeps its existing resources and flow.

`portable-snapshot.mjs` validates and resolves source data. `display-core.mjs`
delegates snapshot dates/timelines to it; all timelines use the existing
`resolvePresentation`. Owner windows are subtracted from classroom intervals,
preserving original classroom rows and source addresses separately. Contextual
staff never enters primary Now/Next. Pure points stay outside duration rows;
workday departure metadata clips source-bound intervals and gives an upcoming
boundary during a final gap. Native explicit passing remains authoritative;
ordinary empty time remains a neutral gap. Lunch splitting follows the native
first rule for a period and only an exported choice; NO_LUNCH/missing stay unsplit.

Template revisions select the latest effective revision on/before the requested
date. Kidzfun requires no school-specific code: exported exception/template
records resolve its exact dates and morning sequence. Date controls query the
same frozen profile for previous/next date, tomorrow, selected date and Today.
Other dates are static previews; Today uses the existing live state engine.

The generic editor permits profile name and activity display-name/room overrides.
Source times, cycles, calendar, lunch rules/selections, special-date templates,
point rules and ownership remain locked. It preserves the original snapshot and
all native/unknown fields. It does not flatten per-day assignments into new source
data. Existing WMHS/Galvin quick-setup editors remain distinct and unchanged.

Storage architecture and backup envelopes remain version 1; normalized configs
remain schemaVersion 2. Reload, both single-profile and all-profile backup
round trips retain original snapshot, assignments, owners/context, points and
local edits. Imported profiles always receive independent local UUIDs.

Unsupported required constructs are reported per bundle entry: future snapshot
schema, unknown required cycle/period/calendar kinds, and templates with
`unconfirmedEndFrom` (completion policy not yet supported). Malformed source
data still aborts preparation atomically. Snapshot-free non-WMHS files remain
unsupported; no source definition is guessed. Contextual staff and purely
contextual points are retained and exposed to the timeline API/backups, but do
not have a separate dashboard view. Native colors are retained, not reproduced.

## Native test provenance

`tests/fixtures/canterbury-room2-v2.json` was generated using the current native
`BellSyncSharedSchedule(profile:)` exporter with the complete version
2026-2027.3 Canterbury definition and native `ProfilePersonalActivity.seed`.
It is a realistic native export, not Christine's device file. No device export
was available in the repository. The fixture includes all 32 Kidzfun dates,
closures, early closing, full classrooms, owner/staff layers and departure points.

`canterbury-native-days.json` records actual `ScheduleEngine.genericEvents`,
`secondaryStaffEvents`, and `scheduledPointEvents` results for 37 representative
dates including all Kidzfun dates, normal Tuesday/Thursday and M/W/F days, a
closure, early closing, and the last operating day. Tests compare title, room,
start/end, contextual staff and points against those native results.
`canterbury-fixture-export.swift` records the read-only fixture-generation driver;
it can be compiled alongside the six Foundation sources used by native tests.
The expected-day file is filtered to these representative dates after generation.

Additional deterministic tests cover unknown schools, snapshot precedence for
WMHS/Galvin IDs, weekday rotation, revisions, suppression, native/local names and
rooms, personal restrictions, explicit passing, neutral gaps, generic lunches,
boundary completion, safe editor save/cancel, date controls, independent profiles,
backup/reload, unsupported bundle entries, and malformed atomic rejection.
