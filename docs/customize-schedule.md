# Customize Schedule editor

UI-only replacement for the portable snapshot “Edit Imported Schedule” dialog.
The school name appears below the title. Classes opens by default; a lunch-help
entry point opens Lunch directly. Unsupported Lunch/Calendar tabs are omitted.
Other editor types (manual schedules and the WMHS/Galvin managed editors) keep
 their existing interfaces.

## Control inventory and placement

| Previous control | New location | Same saved field/path |
|---|---|---|
| Schedule display name | Classes | Profile name |
| Period/activity display names | Classes, compact rows | Portable period edits |
| Profile owner activity names | Classes, Personal activities | Portable personal edits |
| Optional room overrides for both activity types | Classes, compact rows | Portable edit room |
| Individual time and start/end overrides | Classes → Advanced Timing (collapsed) | Existing timing overrides |
| Per-boundary and whole-activity ±1/±5 minute buttons | Advanced Timing | Existing timing controls |
| Source times, dated source variants, Reset to Source | Advanced Timing | Existing timing controls |
| Supported generic per-day lunch choices, including No Lunch | Lunch when supported | Existing lunch assignment setter |
| WSHS P5/P6 semester-one choices | Lunch → Semester 1 | Existing WSHS apply handler |
| WSHS independent semester-two Automatic/L1/L2 choices | Lunch → Semester 2 | Existing WSHS apply handler |
| Effective lunch/date summary | Lunch | Existing preference calculation |
| WSHS five conditional make-up statuses | Calendar | Existing WSHS correction handler |
| Preserved source-conflict notices | Calendar → Preserved custom changes | Existing conflict metadata |
| Cancel, Close, backdrop, Escape | Fixed header/footer | Discard detached draft |
| Save Changes | Fixed footer | Existing atomic profile save |
| Contact Support | Footer | Existing support link |

School-specific controls remain in the existing WSHS renderer. The shared editor
uses supported-feature discovery; it does not define school lunch options or
add unsupported calendar editing. No new date-exception editor is introduced.
For other schools, only lunch controls previously supported by this portable
editor appear. Source period identities, school definitions and official times
are never changed by display-name edits.

## State, validation and accessibility

All tab panels and controls are mounted once for the lifetime of the dialog.
Switching tabs toggles visibility and retains input values and scroll positions.
One save applies Classes, Lunch, Calendar and timing edits together through the
same validation/setter/profile-store chain. Cancel, Close, backdrop and Escape
have the same discard semantics, without a new confirmation step. A failed save
cannot write partial profile changes; a retry rebuilds local display edits from
 their original draft so reverting a field after an error is respected.

Tabs have tablist/tab/tabpanel relationships and roving keyboard focus. Left and
Right arrows, Home and End navigate tabs. Keyboard Tab stays within visible
modal controls. Closing returns focus to the opener or Schedule menu button.
Validation identifies the relevant tab/field and opens Advanced Timing when a
 timing field needs correction. Storage/concurrent-edit failures remain general
save errors in the visible footer area. Existing time validation, quick-step and
Reset to Source handlers are unchanged.

The header/tabs and footer remain outside a single internal scrolling area. The
840px maximum-width dark dialog uses mint selected tabs, subtle row dividers,
compact controls and responsive rows. Below 380px, optional rooms stack beneath
names. Support remains available in the footer. Browser focus, actual layout,
scroll behavior and persistence have not been runtime-tested.

## Static validation

- JavaScript syntax parsing and Git whitespace checks pass.
- Fingerprints verify all schedule/calculation, definition, calendar, countdown,
  profile-storage, deployment and other pre-existing files outside `app.js` and
  `styles.css` are unchanged.
- Source comparison confirms the WSHS apply callback, timing editor and input
  serialization, global modal/discard, profile save, managed editors and Display
  Settings entry point are unchanged. WSHS control destinations/copy differ only
  in presentation.
- Reviewed bindings for all controls listed above, single-save submission, DOM
  retention across tabs, error routing and all discard paths.
- No builds, browser launches, automated UI tests, screenshots, commits, pushes
  or deployments were performed. Static checks do not establish visual quality
  or runtime behavior.

## Manual Safari review

1. Open the local Web Display and choose a saved imported/snapshot schedule.
   Use Schedule → Edit Schedule. Expect Customize Schedule with the school name
   and Classes selected. Existing custom names/rooms must load unchanged.
2. Change the profile name, one class name and a room. Switch through all supported
   tabs and return. Values and scroll position must remain. Source labels/IDs and
   official schedule times must be unchanged after saving.
3. Expand Advanced Timing. Check every existing boundary field, ±1/±5 minute
   control, whole-activity shift and Reset to Source. Untouched partial overrides
   and dated source variants must survive saving.
4. With WSHS, verify separate Semester 1 P5/P6 and Semester 2 Automatic/manual
   controls. Change one of each, switch tabs, and confirm the effective summary.
   Calendar must show the five current make-up statuses without activating any.
5. On a disposable local profile, change a Calendar status and a Lunch choice and
   save alongside a class/room edit. Refresh/reopen; all must persist together.
   Restore the temporary correction. The WSHS exam/semester/calendar checklist
   in `wshs-2026-2027.md` remains applicable; the scheduling engine is unchanged.
6. Change fields in all tabs, then separately test Cancel, Close, backdrop and
   Escape. Reopening must show only the previously saved values, with no partial
   persistence. Test a failed save followed by reverting a draft field and retry.
7. Submit a blank/whitespace name from a different tab. Classes and the exact
   field should receive focus with an error. Make an adjusted end precede its
   start, switch tabs, then save: Classes/Advanced Timing should open and identify
   the time field. Correct it and save. Verify hidden tabs do not block validation.
8. Check a portable WMHS profile with configurable lunch and a snapshot school
   without lunch/calendar settings. No empty unsupported tabs should appear;
   all previously editable activities and timing controls must remain available.
   Check a school with personal activities and custom source names as well.
9. Use only the keyboard: arrow/Home/End tab navigation, Tab/Shift-Tab within the
   dialog, Escape to discard, and focus return to Schedule. Verify narrow Safari
   windows/tablet width, long activity lists, footer visibility and internal scroll.
10. Save/reload and export/import a portable Display backup. Verify names, rooms,
    timing overrides, lunch choices and corrections survive. Smoke-check other
    schools and the unchanged standalone Display Settings/Timing editors.

## Local preview

If the existing server on port 8080 is running, open
`http://127.0.0.1:8080/?school=wshs` manually and reload to get the latest UI.
Otherwise, start one server from the BellSyncWebDisplay folder using the existing
method: `python3 -m http.server 8080 --bind 127.0.0.1`. No build or install is needed.
Do not clear existing browser storage or use production to review unpublished UI.
