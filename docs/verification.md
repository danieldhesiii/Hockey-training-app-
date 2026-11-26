# Verification record

Checked on 24 November 2026.

## Repository import verification

Imported from `shift-hockey-source.zip` into `danieldhesiii/Hockey-training-app-` on 24 November 2026, using `dev`. The destination repository had no branches or commits. No `main` branch was created or pushed.

All application code, programme data, tests, scripts and deployment configuration match the supplied archive byte-for-byte. Only repository/workflow documentation and this verification record were updated. The programme was not regenerated.

Verified locally with Node 24.16.0 and npm 11.13.0:

- `npm ci --ignore-scripts --no-audit --no-fund`: passed, no dependencies.
- `npm run check`: passed, including 52 weeks, 622 sessions and 2,252 exercise prescriptions.
- `npm test`: 61 passed, zero failures.
- `npm run build`: passed, 22 local assets, cache version `ddd7cc450a0925`.
- `npm run dev`: started at `http://localhost:5173`; `/` and all 22 production assets returned HTTP 200 and matched the built files byte-for-byte.

The browser observations below are inherited from the supplied source's verification record; they were not repeated during this import. Remote push verification is reported separately after execution. No live cloud service or production deployment was changed during the import.

## Automated checks

`npm run check` passes the Node version, complete programme schema/references, local PWA assets and JavaScript syntax.

`npm test` passes **61 tests**:

- 28 coaching and date tests cover missing data, progression gates, incomplete/duplicate sets, repeated misses, template/variant isolation, deloads, readiness, workload comparison, finite Epley estimates and UK daylight-saving boundaries.
- 15 programme tests cover 52 weeks, every reference, holiday exclusions, no Monday gym, weekly slot structure, full session budgets, exact targets, foot contacts, replacement tests, deload spacing and indoor shooting swaps.
- 6 equipment tests cover throw and loaded-jump units, stationary runner settings, exclusion from kilogram progression, explicit target swaps and ballistic holds on reduced/taper days.
- 2 interval tests cover all rounds, distinct between-block recovery and no added final rest.
- 10 storage/transport tests cover full seed validation, JSON/CSV round trips, invalid data rejection, deterministic LWW, simulated paginated cloud transport and the SQL security contract.

The storage tests also verify preservation of logged, edited, started, skipped and deleted session families during baseline refresh, including reordered or removed prescription IDs.

The transport harness checks a 501-record pull, an edit made while a push is in flight, retention after a network failure, a successful retry, and account/project isolation. These are simulated server tests.

## Browser observations

- The app loads the full programme and reports Offline ready.
- Desktop dashboard layout was visually inspected.
- The responsive layout was visually inspected at a 412-pixel content width, including phone navigation and primary controls.
- A deliberately labelled QA set was saved in native IndexedDB and remained after a page reload.
- An app asset update appeared through the service-worker update prompt and loaded the new Progress controls.
- With the preview server stopped, the cached app reopened, the exercise library searched successfully, complete exercise instructions opened, and another QA set saved locally.
- Temporary set entries were soft-deleted after the checks. They are not present in any shipped seed or deliverable.
- The equipment update loaded through the service-worker update prompt. A labelled medicine-ball QA entry saved as three throws per side with a 2 kg ball, without landing contacts; it was then removed.
- The resisted-runner alternative displayed its own four five-second bouts, full recovery and required setup confirmation. A labelled QA entry saved as five seconds at setting 8, unit level and RPE 6. It was then removed and the original acceleration block restored.
- The trap-bar jump form displayed jump count, total bar-plus-plates mass, optional height and two foot contacts per bilateral landing. The updated workout layout was visually inspected.

## Not claimed as verified

No physical Samsung or Mac installation was performed. The phone-width browser check is not a test of device-specific audio, vibration, keyboard or operating-system background behavior.

No Supabase project was provisioned or modified. The SQL has been inspected and contract-tested, but actual execution, configured RLS isolation, email delivery and phone-to-Mac sync must be verified after the user connects a dedicated project. The setup guide gives those smoke checks.

The optional external forecast and personal video links require internet access. A stopped preview server checks local app dependence, not every possible network or browser-storage failure. The final app source is dependency-free and its build precaches all 22 generated app assets.

## Exercise alternative picker update, 24 November 2026

The picker now searches the training exercise library, starts with the current category and lists similar movements first. All six core replacements for dead bug are available. Replacement targets come from that exercise's own baseline prescription where available; otherwise targets must be entered. Sets, reps/time, sides, rest and effort can be edited. Machine and power units remain distinct, equipment setup confirmation and symptom checks remain active, and saved entries block an exercise swap. Obsolete test and swap metadata is explicitly cleared for merged storage writes.

Validation: `npm run check`, all 67 automated tests and `npm run build` passed. Browser checks on localhost verified the six core choices, search for reverse crunch, saving a temporary alternative, persistence after reload and restoring the original dead bug targets. No training results were entered. All programme JSON and the readable 52-week programme are unchanged. These checks do not claim a production deployment or live cloud sync.


## Custom exercises and workouts, 26 November 2026

Implemented a custom exercise editor and workout builder on `dev`. New exercise definitions use the existing library, alternative picker, storage, backup and optional sync tables. Workout creation writes the session and all blocks in one IndexedDB transaction with their outbox records. Edits preserve logged blocks, including blocks referenced by soft-deleted entries. Copying assigns new session and block identities and does not copy training results. Baseline sessions are copied rather than edited through this builder.

Validation: `npm run check`, all 74 tests and `npm run build` passed. Automated checks cover custom exercise schema, seed-refresh preservation, logging units, new workout identities, independent copies, scheduling/time constraints, history protection and invalid input. The complete programme JSON, exercise seed and readable 52-week programme remain byte-identical to the previous revision.

Chrome extension tests used a separate local preview on port 5174. Verified exercise creation and persistence after reload; creation inside a workout without losing its draft; two exercise blocks with reps and timed logging; block reordering; saving and reloading a workout; a labelled QA set locking its block; removal of an unlogged block; and copying the workout onto another date with zero saved entries. The QA set was soft-deleted afterwards. These test records exist only in that local preview origin and are not shipped or copied into production. No production deployment or live cloud sync is claimed for this update.
