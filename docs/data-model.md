# Data model

SHIFT keeps the native IndexedDB database `shift-hockey-v1` as its source of truth. Every entity record has `id` (UUID), `createdAt` and `updatedAt` (UTC ISO timestamps), and `deleted` (boolean). A user mutation also has `changeId` (UUID) for deterministic equal-time conflict resolution. Local calendar dates use `YYYY-MM-DD` in Europe/London.

## Entity tables

| Table | Important fields | Relationships and use |
| --- | --- | --- |
| `users` | `displayName`, `preferences` | Athlete preferences, increments, confirmed events and optional equipment variants. This is not the Auth password store. |
| `plan` | `title`, `startDate`, `calendarStartDate`, `endDate`, `totalWeeks`, `holidayRanges`, `eventWindows`, `progressionRules`, `readinessRules`, `deloadRules`, `gameRules`, `testRules`, `timingConventions` | Full programme-level rules and explicit assumptions. |
| `phases` | `name`, `startWeek`, `endWeek`, `focus`, `intensity`, `weeklyTemplate`, `description` | Long-term training emphasis. |
| `weeks` | `number`, `startDate`, `endDate`, `phaseId`, `deload`, `testing`, `holiday`, `focus`, `volumeFactor`, `targetRpe`, `intensityRange` | Links the calendar to a phase. |
| `sessions` | `weekId`, `phaseId`, `date`, `templateId`, `kind`, `title`, `durationMin`, `intensityRpe`, `optional`, `environment`, `status`, `warmup`, `cooldown`, `durationBreakdown` | Scheduled training. Completed sessions add `actualDurationMin`, `sessionRpe`, `completedAt`, `completionNotes`. Changes may add `originalDate`, `isGame`, `extra`, `indoorSwapActive`, `startedAt`. |
| `session_exercises` | `sessionId`, `exerciseId`, `order`, `role`, `targetSets`, `notes`, `repRange`, `rampUpSets`, `preWorkRestSec`, `indoorSwap`, `testProtocolId`, `linkedTestProtocolIds`, `variant` | Fully expanded work prescription. `targetSets` includes exact reps/seconds/distance/contacts, rest, tempo, RPE/RIR, load rule and a blank uncalibrated load. |
| `exercises` | `code`, `name`, `category`, `movementPattern`, `equipment`, `muscles`, `quality`, `cues`, `mistakes`, `regression`, `progression`, `environment`, `videoUrl`, `wristSensitive`, `loadConvention`, `loadMultiplier` | Stable short human codes such as ST01 plus UUID references. |
| `set_logs` | `sessionId`, `sessionExerciseId`, `exerciseId`, `date`, `kind`, `setIndex`, `loadKg`, `reps`, `rpe`, `rir`, `tempo`, `notes`, `variant` | Strength, power, speed, conditioning, holds and mobility. Other fields include contacts, distance/height, sprint time, actual rest, duration, intervals, manual HR and sides. Progression snapshots include `targetReps`, `targetRpe`, `expectedSets`, `loadRule`, `repRangeMax`, `reduced`, `deload`. |
| `skill_logs` | `sessionId`, `sessionExerciseId`, `exerciseId`, `date`, `kind`, `durationSec`, `notes` | Handling adds touches/errors/eyes-up percentage. Shooting adds shotType/shots/hitsByZone/shotSpeedKmh/releaseTimeSec. Rehearsal has kind `rehearsal` and never creates shooting accuracy. |
| `test_results` | `testCode`, `exerciseId`, `date`, `value`, `unit`, `method`, `attempts`, `protocolVersion`, `protocolConfirmed`, `clinicianCleared`, `notes`, optional `sessionId` | Only actual results. Different methods and protocol versions remain separate. |
| `wellness_logs` | `date`, `sleepHours`, `sleepQuality`, `soreness`, `energy`, `mood`, `bodyweightKg`, `wristPain`, `wristWorse`, `gripLimited`, `illness`, `readinessScore`, `notes` | One normal check-in per calendar day. Bodyweight and symptom flags are outside the numerical readiness formula. |
| `personal_records` | `type`, `exerciseId`, `value`, `unit`, `date`, `sessionId`, `variant`, `method`, `testCode`, `testResultId`, `protocolVersion`, `title`, `notes` | Maintained from actual completed lifts and recorded tests. Estimated strength remains labelled as estimated. |
| `sync_queue` | `table`, `recordId`, `record`, `changeId`, `attempts` | Local immutable snapshots awaiting acknowledgement. Seed definitions are not fake activity or an initial cloud upload. |

Some optional fields are absent when they do not apply. Missing measurements are `null` or absent, never silently replaced with zero. Valid measured zero remains zero. Exercise IDs and other references are checked during seed generation and backup validation.

## Private local metadata

The `_meta` object store has `{key,value}` entries for preferences, seed fingerprint/ID manifest, source citations and test protocols. It also holds optional sync configuration, verified account binding and Auth session tokens. These are infrastructure records, not training entity records.

Only explicitly allowlisted safe metadata is exported. Passwords, access tokens, refresh tokens, API keys, project connection values and account bindings are excluded from JSON/CSV backup files. Passwords are sent to the user's configured Supabase Auth endpoint and are not saved by SHIFT.

## Atomic local changes

`save(table, row)` and `saveMany(table, rows)` create canonical metadata and store each changed entity together with its queue snapshot inside the same IndexedDB transaction. A deletion is a timestamped tombstone. The queue records the exact changed revision; acknowledgement deletes only those revision IDs, not all pending edits to the entity.

Baseline refresh also uses one transaction after its fingerprint and incoming definitions have been validated. It preserves edited records and all history. Rendering never fabricates log records just to fill a chart.

## Optional cloud representation

Each named public SQL table has:

```sql
user_id uuid not null references auth.users(id) on delete cascade,
id uuid not null,
created_at timestamptz not null,
updated_at timestamptz not null,
change_id uuid not null,
deleted boolean not null default false,
data jsonb not null,
server_updated_at timestamptz not null default clock_timestamp(),
primary key (user_id, id)
```

`data` contains the complete entity JSON, preserving the flexible exercise and log structures. Check constraints require its canonical identity/version metadata to match the typed SQL columns. The composite primary key lets different authenticated users use identical deterministic baseline IDs without sharing any rows.

SELECT, INSERT and UPDATE each have owner-specific RLS policies. Anonymous/public table permissions and RPC execution are revoked. Authenticated table grants are explicit, independent of RLS. `shift_push` and `shift_pull` run with caller privileges and an empty search path, and accept only a fixed table allowlist. The `sync_queue` SQL table exists for schema completeness, but local outbox snapshots are never uploaded through these RPCs.

`shift_push` performs an atomic conditional upsert using `(updated_at,change_id)` and returns the winner. `shift_pull` visits the owner’s records using table-name/UUID keyset pagination and includes tombstones. It traverses all records each time; an insertion before an in-progress cursor is picked up on the next traversal. No client timestamp watermark silently drops a late commit.

The flexible data model does not place foreign keys between the JSON payload references. Generation/import validation and application relationships maintain them. Auth ownership is enforced by SQL and never accepted from the client payload.

## Backup format

JSON has `{app,schemaVersion,exportedAt,tables,metadata}`. It contains every entity table, including tombstones and pending queue data for inspection. Import ignores historical queue snapshots and makes new queue entries only for accepted newer records. It compares versions before merging and rejects unknown tables, secret fields, malformed identifiers and invalid numeric values.

Lossless CSV uses two columns: `table,recordJSON`. Each cell's JSON preserves nested sets, zones, notes, Unicode and null values. This format is intended for reliable ownership and round trips; use the app's charts or parse the JSON column for analysis. A note starting with a spreadsheet formula marker remains inside JSON rather than becoming an executable formula cell.

## Boundaries

Local training storage belongs to a browser origin and device. It is not automatically shared by a Git repo or copied to a new hosting URL. Optional cloud sync requires the schema, Auth settings and the same account on both devices. Signing out preserves data and account binding; switching to another account or project requires a backup and explicit local clearing.
