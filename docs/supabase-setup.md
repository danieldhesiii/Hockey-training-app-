# Optional Supabase sync setup

SHIFT works on this device without a cloud account. To share training records between the Samsung phone and the Mac, use one Supabase project and the same account on both devices. The local programme and logs remain available when the connection drops.

## 1. Create a dedicated project

Create a new Supabase project for SHIFT. Keep its database password private. Open the project's SQL editor, review `supabase/setup.sql`, and run that file once. The script creates the training tables, owner-only row policies and two sync functions. It refuses to reuse an unrelated table with the same name. Running it again against its own unchanged schema is supported.

This delivery has not created or changed a remote project. If you use an existing project, first review its schema and take a backup; the intended path is a separate project with no unrelated tables.

The schema uses common typed metadata and a JSON payload so the browser can preserve a complete training record. Each primary key is `(user_id, id)`. Seed IDs are deterministic and can safely be shared by different owners. Foreign-key ownership references `auth.users`; relationships inside the programme payload use the documented UUIDs rather than additional database foreign keys. `sync_queue` exists as an owner-protected reserved table for schema completeness, but the app's outbox is local only and the RPC allowlist excludes it.

## 2. Configure authentication

Enable email and password sign-in in Supabase Auth. Keep email confirmation enabled for a public deployment. Set the Site URL to your deployed HTTPS app origin and permit that exact URL in redirect settings. The default confirmation link can return to the app; the app removes session tokens from the URL after reading them. You can also confirm the email and then sign in using the password.

The app requires at least eight password characters; the project can enforce a stronger policy. A successful sign-up may return a confirmation-required message instead of logging in immediately. Follow the email link before password login.

This version implements email and password authentication. A numeric email OTP extension would use POST `/auth/v1/otp` with `create_user:false`, then POST `/auth/v1/verify` with email, token and type `email`. It also needs an email template that includes the token. New free projects using default Supabase email delivery cannot customize templates under the June 2026 change, so do not assume a numeric-code flow is available without configuring suitable delivery. See [email passwordless setup](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [the template change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

## 3. Connect both devices

In the project's API key settings, copy the project URL and its **publishable key**. Open SHIFT Settings, enter those two values and save. Create an account, confirm the email if required, and sign in. Use that same project URL and account on the other device.

Use a publishable key beginning `sb_publishable_`. A legacy anon key is supported for an existing project. Never enter a secret key, service-role key or database password; the app rejects elevated API keys. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

The URL must be the project origin, such as `https://your-project.supabase.co`, without `/rest/v1` or `/auth/v1`. A local Supabase development origin may use localhost HTTP. Production uses HTTPS.

## 4. Confirm sync with a real log

Create one small, accurate training or wellness log on the first device. Wait for the sync indicator to show a completed sync with no pending changes. Open or refocus the second device and run sync. Verify the same log appears. Edit the log on the second device, sync, then check the first device. Test deletion with a temporary log that you created specifically for verification.

Do not use fake training activity to populate a dashboard. A test record should be labelled clearly and removed afterward. Deletion creates a tombstone that syncs, so older offline copies do not simply recreate it.

The implementation is ready for a project configured with the supplied SQL. Remote authentication, RLS and cross-device behavior must be verified against your configured project before relying on it as a second copy of your training history.

## How changes are protected

- A local record and its outbox entry are saved in one IndexedDB transaction.
- The server atomically chooses the later `updatedAt` value. Equal timestamps use a deterministic `changeId` UUID tie-breaker.
- A push acknowledgement removes only the exact outbox entries that were sent. A change made during that request stays queued.
- A pull accepts a cloud record only if it is newer than the local record. Tombstones take part in the same comparison.
- Sync errors stay visible. Failed requests retain the outbox and can retry on the next foreground sync.
- The cloud identity always comes from the verified auth token, never a user ID supplied in a record.

Conflict resolution operates on one record at a time. Editing the same record independently on two offline devices can lose the older version of that record by design; it is not a collaborative field-by-field merge. Keep both device clocks correct. Distinct logs have distinct UUIDs and therefore do not conflict with one another.

Pagination reads the cloud dataset in ordered pages during each sync. A concurrent insertion before the current page cursor is collected on the next sync. The app does not use an unsafe permanent timestamp or sequence watermark. It does not need Realtime, Storage, Edge Functions, subscriptions or service-role credentials.

## Programme updates

When a new app build includes a changed programme, the app computes a SHA-256 fingerprint before opening the seed transaction. It refreshes unedited baseline definitions and adds new definitions. It preserves personal changes, tombstones, profiles and all activity logs. A stored baseline-ID manifest allows the app to remove an obsolete baseline row only when that row is still unedited. These baseline refreshes do not create cloud outbox entries; each updated device loads the same shipped programme.

A database from before this manifest was introduced cannot reliably identify every removed old baseline row on its first refresh. Those unidentified rows are preserved. For a deliberate custom reprogramme, import records with newer timestamps through the normal validated import. Import merges data, so leaving a row out of a backup does not delete it; intentional removals require newer tombstone records or an explicit deletion in the app. Unknown personal plan records are preserved rather than treated as obsolete seed data.

## Offline behavior, account switching and backups

Sync runs while the app is open, when it regains focus or visibility, when the network returns, and when the app reopens. A closed mobile app does not guarantee continuous background sync. First load the app online and wait for offline readiness before using airplane mode.

The first signed-in account binds the local dataset to that account and project. Sign-out removes the local session and attempts to revoke this session on the server. Disconnect also removes the connection configuration. Both preserve logs and account binding. To switch accounts or projects, export your data, sign out, then clear this device. This explicit reset avoids mixing two accounts' records. Clearing the local device is not a cloud deletion; signing into the same account again can restore cloud records.

Use JSON for a complete portable backup, or the lossless CSV option. CSV contains table names and JSON records, including notes, timestamps, IDs and tombstones. It is intended for reliable round trips, rather than a flat statistical spreadsheet. Imports merge newer data and create a fresh outbox. Imported queue snapshots, credentials, sessions, project configuration and account bindings are never replayed. Only import a backup belonging to the athlete whose data you intend to keep on this device.

Browser storage can be cleared by the user, the operating system or browser policies. A cloud copy helps after successful sync, while regular file exports provide another independent copy. The local database and session are not an encrypted vault; protect access to the device.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login needs email confirmation | Confirm the email, then sign in again. Check the project's delivery settings if no email arrives. |
| Function not found | Run the supplied SQL in the configured project and confirm the URL points to that project. |
| Permission denied or no rows | Check explicit grants, owner RLS and function EXECUTE grants in `setup.sql`. Automatic grants are no longer a safe assumption. |
| Local account mismatch | Use the originally bound account, or export and clear before switching. Disconnect alone intentionally does not remove the binding. |
| Pending changes after a timeout | Local records remain saved. Keep the app visible and retry sync when connected. |
| Expired session | Sign in again with the same account. The local outbox remains available. |
| Conflict after using two devices offline | The later record version wins. Review the changed record and correct it once both devices are connected. |
| Clear-device action is blocked | Close other SHIFT tabs or windows on the same browser, then retry. |

## Deployment verification

Use the project's authenticated API with two separate test accounts to confirm that neither can read, insert into, or update the other's rows. Verify anonymous access is denied. Attempt a stale update and an equal-timestamp tie through `shift_push`, verify the canonical winner, and test more than 250 rows through paginated pull. Those are deployment checks, not changes this delivery has already made remotely.

Sources: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API security and grants](https://supabase.com/docs/guides/api/securing-your-api), [October API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [Supabase Auth endpoints](https://github.com/supabase/auth/blob/master/README.md), [PostgreSQL conflict handling](https://www.postgresql.org/docs/current/sql-insert.html). Research date: 24 November 2026.
