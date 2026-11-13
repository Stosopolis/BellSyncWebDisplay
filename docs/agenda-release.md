# Bell View and Classroom View · release 1

Authorized production release on November 13, 2026. Previous production commit:
`a8c8565d337bfa5b68bda9406c538d4b6fc650bf`. Runtime asset revision:
`agenda-release-1`.

## Deployment

The existing Git connection is `Stosopolis/BellSyncWebDisplay`, branch `main`,
to Vercel project `bellsync-web-display` in `class-forge-s-projects`.
The public domain is https://display.bellsync.app/ and the project alias is
https://bellsync-web-display.vercel.app/. There is no local build step.
The GitHub Vercel commit status and Production deployment record establish the
release status; HTTP responses and byte comparisons establish served asset parity.
Do not use GitHub Pages or create another hosting project.

## Behavior

Bell View is the initial view on every page load. A saved Display profile enables
the shared Bell View / Classroom View toolbar. Classroom View is optional and does
not require a query parameter on the public domain. Initial setup and unsaved Demo
retain their existing workflow; save a profile to use Classroom View.

The public gate permits `display.bellsync.app`, `localhost` and `127.0.0.1`.
Other hosts cannot enable it through a query parameter. Internal mode identifiers
and storage keys are unchanged. The optional Classroom bootstrap still loads after
Bell View and restores Bell View if mounting fails.

Classroom View includes lesson editing, inline durations, date navigation, Copy
Agenda, Fit to Class Time, automatic and single-activity timers, pause/resume,
finish versus skip, adjustments, teacher-led recovery and optional chimes.
Timers use resolved official class boundaries; no school data or shared countdown
calculations are replaced. Sound remains off by default and requires teacher
interaction. The unused `agenda/classroom-ui.mjs` prototype is excluded.

## Backup compatibility

Agenda Backups exports separate version 2 JSON files. Existing Display backups and
version 1 Agenda backups remain supported. Restore Display profiles first on a
new computer, then explicitly map agendas when profile UUIDs differ. A complete
schedule fingerprint is the fast path. Version 2 can also verify unaffected
lessons across personal profile differences by exact school/definition identity,
class/date identity, resolved segments, times and class details. A changed lunch
boundary, school definition or timing/calendar rule cannot silently redirect a
lesson. Version 1 requires the original matching schedule.

Imports preview conflicts, require replacement consent, protect active/paused/
recovery sessions and commit atomically. They do not resume old timers or change
chime preferences. Data remains local to the browser. Files are limited to 5 MiB,
5,000 agendas total and 3,650 agendas per profile. Records with missing original
school descriptors are preserved in exports but cannot be automatically mapped.

## Verification and smoke review

Release checks run the dependency-free Node suites in `tests/*.mjs`, JavaScript
syntax parsing, module/export/reference checks, unchanged school/profile engine
comparisons, CSS structure, whitespace and staged-file review. Inert DOM test
doubles are source regression checks, not automated browser tests.

HTTP verification checks HTML, release JavaScript/CSS, the public gate, all reachable
modules and required assets against the committed files. It does not verify Safari
interaction, audio playback, browser storage or live timer behavior.

After deployment, manually check:

1. Open the public site without a query parameter. Confirm Bell View is initially
   selected and existing schedules/settings remain intact.
2. Switch to Classroom View and back. Verify toolbar actions, fullscreen and a
   narrow window; the official countdown must remain correct.
3. Save/edit/copy a lesson, change an inline duration, and refresh. Check the original
   and copied class/date associations.
4. In a live eligible class, start a single timer and an automatic agenda separately.
   Check pause/resume, finish/skip, adjustments and recovery. Enable and test chimes
   only deliberately.
5. Export agendas, preview an import, and verify duplicate/conflict handling. On a
   second computer, restore Display profiles first and explicitly map the Agenda
   backup; verify saved content without reviving sessions.
6. Check a WSHS exam/early-dismissal date and semester lunch settings, then one other
   school's ordinary schedule and Customize Schedule.

## Rollback

If post-release HTTP verification finds a serious fault, create a new revert
commit for this release on `main` and push through the same Vercel Git connection.
Confirm the revert deployment and compare served assets with the previous working
commit above. Do not reset shared history or clear any browser storage.
