Galvin Middle School source data

`schedule.json` is transcribed from the native BellSync repository's
`Sources/ScheduleEngine.swift`, `SchoolProfile.loadGMS`, content version
2026-2027.1. Grade-specific regular bells, common early-release bells, lunches,
WIN period IDs, and specialist period metadata are preserved.

`calendar.json` is an unchanged copy of `Resources/GMS/gms-calendar.json`.
SHA-256: 137eb16907f09c8056217e93661950ce62cd6bec2204c133c35f916575e5154e

Normalization follows native `gmsEvents`: calendar dates supply Day 1–6 and
regular/early-release templates; regular days include grade lunch; early
release has no lunch; FLEX notes replace the grade's WIN-period title and
clear its room; WIN notes prefix an assigned title and clear its room.
Calendar dates outside the published school year do not receive guessed bells.

The native definition excerpt in `tests/fixtures/gms-native-definition.swift`
records the source used for deterministic bell-data comparisons. Refresh the
resources and fixture together when authoritative native data changes.

Quick setup supports all timing/rotation features of this built-in definition.
It does not add Galvin native-file import support or native personal activity
overlays. Existing native import compatibility remains unchanged.
