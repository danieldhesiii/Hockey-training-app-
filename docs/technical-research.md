# Technical research and implementation decisions

Reviewed 24 November 2026. Only primary project documentation and original research are used. This document records the rationale for the optional backend and the test catalogue. No Supabase project was created, queried or changed.

## Current Supabase changes checked before implementation

The [official changelog](https://supabase.com/changelog.md) was reviewed before writing the backend. The relevant API exposure change removed reliance on automatic table grants, including for existing projects from 30 October 2026. `setup.sql` therefore grants only SELECT, INSERT and UPDATE to authenticated users, then adds owner policies. It revokes anonymous and public privileges explicitly. See [the API exposure announcement](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

New free projects using Supabase's default email delivery cannot customize email templates following the June 2026 change. Password authentication with email confirmation is the implemented flow. A numeric email OTP flow requires the appropriate email template and delivery configuration; it is not advertised as working without that setup. See [the template announcement](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier) and [passwordless email documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless).

The [November TLS cipher announcement](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) does not require a browser-side workaround for this modern-browser app. The [CLI v3 changes](https://supabase.com/changelog/supabase-cli-v3) matter to future automation: remote targets and write confirmation must be explicit. This delivery uses a reviewable SQL file, not an implicit CLI deployment.

## REST authentication

The app uses native `fetch`, with no client runtime package. The hosted prefix is the configured project origin plus `/auth/v1`. The [Supabase Auth repository](https://github.com/supabase/auth/blob/master/README.md) documents the underlying endpoints. The [password guide](https://supabase.com/docs/guides/auth/passwords) explains account confirmation and password flows.

| Operation | Request | Implementation consequence |
| --- | --- | --- |
| Password login | POST `/token?grant_type=password`, email and password | Store the returned session only in private local metadata. |
| Registration | POST `/signup`, email and password | A user response without tokens means confirmation is still required. |
| Session refresh | POST `/token?grant_type=refresh_token` | Read the latest stored session under a browser lock before refreshing. |
| Verify identity | GET `/user`, bearer access token | Bind the device to the verified user ID and project URL. |
| Local-session logout | POST `/logout?scope=local` | Remove this device's stored session; report an unconfirmed server logout. |

The [sign-out documentation](https://supabase.com/docs/reference/javascript/auth-signout) distinguishes local and global logout. Access tokens remain valid until expiry. The app never claims that removing local credentials revokes an already-issued access token immediately.

[API key documentation](https://supabase.com/docs/guides/getting-started/api-keys) distinguishes a publishable app key from a user's access token. Requests use the key in `apikey` and the user token in `Authorization: Bearer ...`. The browser rejects secret and service-role keys. No key, token, password, connection configuration or account binding is exported with training backups.

## Ownership, grants and atomic conflict resolution

[API security guidance](https://supabase.com/docs/guides/api/securing-your-api) treats privileges and row-level security as separate controls. [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) supports explicit ownership checks on reads and writes. Every cloud table uses `(user_id, id)` as its primary key and references `auth.users` through `user_id`. This lets separate accounts use the same deterministic programme IDs without sharing rows. SELECT uses owner equality; INSERT uses WITH CHECK; UPDATE uses both USING and WITH CHECK. There is no client hard-delete privilege.

The RPCs use SECURITY INVOKER with an empty search path, a fixed table allowlist and `auth.uid()` as the owner. Public and anonymous execution are revoked. This follows the principle documented in [database functions](https://supabase.com/docs/guides/database/functions): avoid elevated privileges when caller privileges can perform the operation.

`shift_push` compares `(updated_at, change_id)` inside `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`. The [PostgreSQL INSERT reference](https://www.postgresql.org/docs/current/sql-insert.html) documents this atomic conflict handling. The tie UUID makes equal-millisecond updates deterministic. This is last-write-wins at the whole-record level, not a field merge. Separate set logs have separate IDs, so ordinary logging does not overwrite an entire workout.

`shift_pull` uses ordered table-name and UUID pagination, including deleted records. Each sync traverses the full cloud record set. It deliberately does not persist a timestamp or sequence watermark, because allocation and commit order can differ. A concurrent row inserted before a page cursor appears on the next traversal. This is a modest personal training dataset, so the simpler repeatable traversal is acceptable.

## Local-first persistence and recovery

[IndexedDB documentation](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) describes asynchronous transactions and storage outside network availability. Each local mutation and its outbox snapshot commit together. Acknowledgement removes only the queue IDs sent in that request. A newer local edit made while a request is in flight has its own queue entry and remains pending. A stale server record cannot replace a newer local version.

The seeded programme is not an activity history and is not queued automatically. Both devices load the same baseline. Edits, logged activity, imports and tombstones can then sync. JSON and lossless CSV exports include all entity tables, tombstones and safe preferences. CSV uses `table,recordJSON` cells; a note beginning with a spreadsheet formula marker stays inside a JSON object. Import validates records and merges newer versions, generates a fresh local outbox, and ignores imported queue blobs. Credentials and configuration never travel through this path.

The first authenticated account permanently binds the local dataset until the user clears it. Sign-out and disconnect preserve that binding. This prevents offline data from silently moving to another account. Export before switching accounts or projects. Local data is browser storage rather than an encrypted vault; device access and browser clearing remain relevant. Browser clocks should be correct because LWW uses client timestamps.

## PWA and hosting

The [service-worker guide](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) requires a secure context, with localhost supported for development. The root app caches its own shell and seed files; authentication and cloud RPC responses should not be put in that cache. Offline use requires a successful first load and service-worker installation.

The [installability guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) covers the manifest, icons and installation differences among browsers. Browser timers and workers are not a guarantee of continuous execution after an app closes. Sync runs while open, on becoming visible, on reconnect and on reopening. A workout timer must derive remaining time from a deadline so it recovers after tab throttling. Sound and vibration depend on browser support and user interaction.

[Vercel build configuration](https://vercel.com/docs/builds/configure-a-build) supports a custom build and output directory for a static project. Use Framework Preset Other, `npm run build`, output `dist`, and Node 22 or newer. No server process or private runtime environment variable is required for the offline app. Supabase connection values are optional user configuration; secret keys do not belong in this static deployment.

## Test catalogue decisions

`public/data/test-protocols.json` contains TS01 to TS13. Every test has an explicit repeatable procedure, frequency, limitations and measurement fields. Original coaching protocols are labelled as such. The wrist-sensitive grip and pull-up tests are disabled by default pending clinical clearance. The first practical reference uses repeatable personal measurements rather than invented fitness ranks.

Published comparison records retain their population, equipment and measurement caveats. The [2026 NHL Combine results](https://media.nhl.com/site/vasset/public/attachments/2026/06/19913/FitnessResults_060626___FINAL.pdf) describe selected draft prospects and published leaders, not professional standards. A [professional Swedish-team study](https://pmc.ncbi.nlm.nih.gov/articles/PMC13543659/) provides instrument-specific sprint and jump context. The [Division III study](https://www.jssm.org/jssm-14-522.xml-Fulltext) used hand-timed agility, while the [major-junior study](https://jhk.termedia.pl/pdf-158715-84976?filename=Functional-Performance-Te.pdf) reports a defined pull-up protocol. These are descriptive samples. Method mismatch is explicit and no universal recreational, junior or professional cutoffs are created.

The [test author's original 30-15 IFT protocol](https://www.30-15ift.com/pdf/protocolENG.pdf) specifies its shuttle layout and audio pacing. That test is optional and replaces a demanding session. The default cycle reference is a practical fixed-load, submaximal trend measure; it is not a laboratory VO2max test and has no fabricated VO2max conversion.
