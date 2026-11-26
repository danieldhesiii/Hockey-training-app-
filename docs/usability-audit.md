# Tracker usability audit

26 November 2026. Changes developed on `dev`; publishing to `main` requires explicit user approval.

## Reproduced problems and changes

| Finding | Result |
| --- | --- |
| Exercise alternatives hidden in a collapsed native select | Visible exercise rows with name, equipment, search, category filter and selection feedback |
| Unclear how to apply a choice | Selected exercise and targets appear beside the list on desktop, below it on phones; the primary action stays visible |
| No direct editor for programme workouts | Edit the selected session, including adding, removing and reordering unlogged blocks, while retaining its required/optional status |
| A logged block prevented changing exercise | Keep that block and its original logs; create a separate replacement block for continued work |
| No way to skip an exercise honestly | Skip and restore a block without fabricating completion or deleting history |
| Inputs disappear after another set saves or the page reloads | Per-exercise input drafts in tab session storage, cleared after successful logging |
| A closed workout builder loses its draft | Restore unfinished builder drafts in the same tab |
| Only some actual entries could be corrected | Edit timed, power, skill and machine entries; update strength entries inline |
| Accidental entry removal | Soft deletion with a 12-second Undo action |
| No chronological session history | Searchable History with completed, in-progress and skipped sessions |
| Hardcoded lift list omits custom movements | All strength exercises using kilogram logging are eligible for the strength trend selector |
| First offline installation can consume the update reload guard | Reload only for an explicitly accepted update, use the current waiting worker and handle updates already activated by another tab |
| Old code is still cached without an obvious update control | Persistent top update banner, manual update check and visible installed build |

## Verification

- `npm run check`, `npm test` (84 tests), and `npm run build` pass.
- Complete programme, exercise seed and readable programme are unchanged from the previous release: 52 weeks, 622 sessions and 2,252 exercise prescriptions.
- Chrome extension: reproduced the production picker problem; further mutation tests used only `localhost:5175`.
- In the local preview, selected a visible replacement, changed targets, saved, logged and reloaded.
- Changed a logged exercise and confirmed the old block, actual set and notes remained intact while the replacement received a fresh block.
- Verified unsaved inputs in another block survived saving and reloading.
- Directly edited a programme session, removed an unlogged block and created a custom exercise inside that session.
- Logged and corrected a timed entry, completed the session, reviewed it in History and reopened it.
- Selected a custom lift in Progress and reviewed actual per-exercise history.
- Exported a JSON backup through the browser. Validated the downloaded file against the application schema and verified a lossless CSV round trip. Importing the JSON through the UI retained one workout with two entries, without duplication. The browser download-event capture timed out, but the file itself was created successfully and verified on disk.
- Applied a waiting app update through the new banner, verified the installed build changed and local records survived. Regression tests cover first-install controller changes, passive updates from another tab and replaced waiting workers. Corrected the first-install reload-guard defect found during repeated browser updates.
- Tested the picker and applying a replacement at 390 x 844, then reset the viewport. This was browser emulation, not a physical phone test.
- Verified closed-builder draft recovery and Undo after removing a recorded set.
- QA entries were labelled and soft-deleted after testing. No QA records are included in shipped source or production seed data.

## Boundaries

The personal/offline tracking flows above are tested. Automated tests also cover backup validation, programme reference integrity, progression, timers, units and simulated sync transport. Actual Supabase provisioning, authentication delivery and cross-device live sync were not performed. The app remains usable with local storage and manual backups. No main release or production deployment is claimed by this audit. The attached grip-update archive has not been applied because no instruction to import it was given.
