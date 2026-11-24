# SHIFT | Hockey Performance

A complete, personal hockey training dashboard and dated 52-week programme. Designed for a Samsung phone and a Mac, with large set-entry controls, local offline storage and optional private Supabase sync.

The programme runs from **24 November 2026 to 21 November 2027**, using calendar weeks beginning **23 November 2026**. It contains **52 weeks, 622 sessions, 2,252 exercise prescriptions, 3,696 explicit working-set targets, 103 exercise definitions and 13 testing protocols**. Initial history is empty. No strength, fitness or wellness results are fabricated.

## Start here

1. Open the deployed app once online and wait for **Offline ready**.
2. Use **Today** for the planned session and a daily check-in.
3. Open a session, log each actual set or drill, then finish with actual minutes and overall session RPE.
4. Read [the complete training programme](docs/training-programme.html) and [the user guide](docs/user-guide.md).
5. Export a JSON backup regularly from Settings.

Supabase is optional. There is no login wall for local training. The same site on two devices has two separate local stores until you configure sync or transfer a backup.

## Run locally

Use Node 22 or newer. There are no runtime or development package dependencies.

```sh
npm install
npm run check
npm test
npm run build
npm run dev
```

Open `http://localhost:5173`. `npm install` only verifies the dependency-free lockfile. The build copies local assets into `dist/`, copies the readable programme, and creates a content-versioned service-worker cache list. No CDN, external font, paid API or server process is required in production.

The browser app must be served over HTTPS or localhost. Opening `index.html` with `file://` does not provide a working PWA or module environment.

## GitHub and development workflow

Repository: [danieldhesiii/Hockey-training-app-](https://github.com/danieldhesiii/Hockey-training-app-).

Use **dev** for changes and local review. Promote to **main** only after the user explicitly approves the release. `AGENTS.md` records this instruction for future coding sessions. No force-push is part of this workflow.

Once the source is pushed, clone and run it on your Mac:

```sh
git clone https://github.com/danieldhesiii/Hockey-training-app-.git
cd Hockey-training-app-
git switch dev
npm install
npm run dev
```

Open `http://localhost:5173`. `npm run dev` builds the current source before starting the server. It does not hot-reload source changes. For a later update, stop the server, then:

```sh
git switch dev
git pull --ff-only origin dev
npm install
npm run dev
```

Keep the same localhost address so the browser uses the same local training store. If SHIFT offers **Update now**, save the current set before accepting it. The code update preserves saved history.

Only after explicit user approval, review and merge `dev` into `main`, for example through a pull request. If this is an empty repository and `main` does not yet exist, create it from the reviewed `dev` revision at release time. Vercel production should use `main`; `dev` remains the working branch.

The downloadable source omits Git metadata, the private preview's Site identity and build artifacts. If uploading it manually, put the contents of its `shift-hockey` folder at the repository root. Inspect existing repository files before replacing anything.

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import your new repository.
2. Set **Framework Preset: Other**.
3. Use **Build Command: `npm run build`**.
4. Use **Output Directory: `dist`**.
5. Use **Install Command: `npm install`** or `npm ci`.
6. Select a supported Node version **22 or newer** and deploy.
7. Open the resulting HTTPS address on your phone, wait for Offline ready, and install it.

`vercel.json` already supplies the static build settings and makes the service worker revalidate. Vercel's personal Hobby plan can host this static personal project within its current plan limits. Check the current terms and quotas in your own account.

Official reference: [Vercel build configuration](https://vercel.com/docs/builds/configure-a-build).

Every later Git push can produce a new Vercel deployment. Use the production address consistently. Preview and production addresses are different browser origins with separate training stores.

### Move from the supplied preview to Vercel

Export JSON from the preview, then open the Vercel address and import it in Settings. Do this once before you start logging at both addresses. Alternatively, connect both to the same dedicated Supabase project and account. A copied URL alone does not transfer IndexedDB data.

## Other static hosting

### Netlify

Import the same repository, use build command `npm run build` and publish directory `dist`. `netlify.toml` is included. Use the resulting HTTPS address consistently.

### GitHub Pages

Build `dist/` with Node 22+ in a GitHub Actions workflow and upload it using the official Pages artifact/deploy actions. Select GitHub Actions as the Pages source. All app URLs and service-worker cache paths are relative, so a repository subpath is supported. The published folder must be the contents of `dist/`, not the repository root.

## Optional Supabase sync

Follow [the complete Supabase setup guide](docs/supabase-setup.md).

1. Create a **new dedicated** Supabase project for SHIFT.
2. Review and run [supabase/setup.sql](supabase/setup.sql) in its SQL editor.
3. Configure your app's production URL and email confirmation redirect allowlist in Auth.
4. In SHIFT Settings, enter the project URL and its **publishable** API key. A legacy anon key is supported when it is a real anon JWT.
5. Create an account, confirm its email when required, and sign in.
6. Use the same project and account on the phone and Mac.

Never enter a secret or service_role key in the app. Authentication is verified against the backend before the local dataset is bound to an account. Owner-based RLS and explicit grants are supplied. This delivery has not created or changed any remote Supabase project.

Local data remains available during a failed login, offline period or server outage. Each changed entity and its pending outbox entry commit in one IndexedDB transaction. Sync acknowledges only the specific changes actually sent, so an edit made while a request is in flight remains pending.

Conflicts use atomic whole-record last-write-wins based on `updatedAt`, with `changeId` as a deterministic tie-breaker. An old remote response cannot overwrite a newer local record. Keep both device clocks accurate. Separate set logs have separate record IDs. See [the schema](docs/data-model.md) for all entities.

Sync runs while the app is open, when the device reconnects, when the app becomes visible and when it is reopened. It does not promise background sync after the phone closes the app. A fresh account on a second device starts with the same baseline and receives your edits and logs.

## What's implemented

- Today view, seven-day strip, upcoming sessions and whole-week load summary.
- Daily sleep, energy, soreness, mood, bodyweight and symptom check-in.
- Large strength set logs with kg, reps, RPE or RIR, notes, prior results and next targets.
- Timed holds, repetitions, contacts, jump height/distance, sprint time, manual heart rate and interval logs.
- Stickhandling bouts, touches, errors and observed eyes-up cues.
- Shooting attempts, target-zone hits, shot speed and release time. Indoor rehearsals remain separate.
- Automatic rest timers, interval timer, stopwatch, sound and supported vibration.
- Full 52-week calendar, list and year views, move/skip controls and extra sessions.
- Searchable exercise library, equipment/category filters, cues, regressions, personal video links and increments.
- Epley estimates, strength-volume trends, sRPE workload, protocol-specific testing trends, skills, wellness, PRs and completion charts.
- JSON and lossless CSV export/import of every entity table and safe preferences.
- Optional Supabase Auth, account-bound local data, RLS SQL, atomic sync and status indicators.
- Service-worker installation, offline app assets and the entire programme.
- Optional Brentwood weather suggestion using Open-Meteo, with manual indoor swaps available offline.

## Training decisions

The default normal week has Tuesday medicine-ball power, upper strength and easy cycling; Wednesday quality speed and main lower-body strength with belt-squat blocks or appropriate squat alternatives; Friday lower power with eligible trap-bar jumps, a cable or multi-hip flexion/extension rotation and a short easy aerobic block; and low-fatigue Sunday upper/core with ab-sling knee raises and cable or multi-hip abduction/adduction. These choices replace existing slots and follow the phase, deload and symptom rules. Medicine-ball and loaded trap-bar jump blocks start in week 6 and are omitted during testing and deloads. Thursday has optional short mobility/core before light roller. Monday has no gym and remains the hardest ice evening. Saturday's optional extras are alternatives; a game replaces practice and takes priority.

The chest-supported resisted runner and the squat resistance machine remain generically named until their models are confirmed. They are alternatives with setup confirmation: timed runner bouts record resistance settings and units, while machine squats use controlled repetitions with feet grounded. No machine jumps are prescribed. Belt-squat setup also requires confirmation of a suitable manufacturer-approved arrangement. Machine levels, psi and bar values are not converted to kg or estimated 1RM, and runner duration is not converted to a 10 m or 20 m sprint time. Trap-bar jumps and medicine-ball throws have their own load and repetition logs; wrist tolerance and movement quality govern use. See [the equipment section of the user guide](docs/user-guide.md#your-added-equipment).

Five skating evenings already create substantial conditioning exposure. Additional hard intervals are conditional replacement work, at most once weekly, and omitted during tests/deloads. The plan includes core, hip and single-leg work without treating every daily task as another hard training session.

5–19 December is a holiday period with no mandatory gym or hockey. 20 December is a return/rest day. 21 December starts a gradual return. The plan uses provisional June/July tryout and September league windows. Enter confirmed dates in Settings rather than inventing fixtures.

All starting weights are blank. Main lift increases depend on complete actual logs. Accessories first reach the upper rep-range target. Deloads and reduced sessions do not earn increases. Two completed target misses suggest a reviewed 7.5% reset. Different templates and equipment variants do not silently share progression.

Readiness is an explicitly labelled coaching heuristic. It is not an injury-risk calculation or clinical assessment. Wrist/grip changes can pause affected work even when the numerical score is high. Loaded rehabilitation follows an individually assessed clinician plan. Recurrent inability to grip warrants appropriate clinical review.

## Update the programme or app

Edit app files under `public/`. For programme changes, edit `scripts/generate-programme.mjs`, `scripts/generate-exercises.mjs` or `public/data/test-protocols.json`, then run:

```sh
npm run generate
npm run check
npm test
npm run build
```

Commit the changed generators, generated JSON and readable programme, then push. `npm run build` deliberately does not regenerate clinical/coaching content implicitly.

A changed shipped programme refreshes untouched baseline definitions on the next app load. An edited, started, completed, skipped, deleted or logged session retains its complete original family of prescriptions and targets, including rows whose generated IDs changed in the new programme. Edited prescription rows and soft-deleted logs also protect their parent session. Referenced exercise definitions remain intact so historical load conventions are preserved. User-edited definitions, tombstones, personal exercises and activity history remain available. New equipment reaches untouched future sessions; already-personalised sessions require a deliberate manual edit or reviewed import. Updating app assets does not clear training history.

When a service-worker update is ready, the app offers **Update now**. Update after saving the current set. The IndexedDB schema remains independent of the asset cache.

## Source map

| Path | Purpose |
| --- | --- |
| `public/index.html`, `public/styles.css` | Accessible mobile-first app shell and dark visual system |
| `public/js/app.js` | Navigation, training forms, calendar, library, preferences and timers UI |
| `public/js/coaching.js` | Transparent progression, readiness and workload calculations |
| `public/js/db.js` | IndexedDB, outbox, baseline refresh, backup validation and imports |
| `public/js/sync.js` | Optional Supabase Auth and reliable transport |
| `public/js/progress.js` | Trends, tests, comparisons and test-record maintenance |
| `public/js/timers.js` | Deadline-based rest/interval/stopwatch logic |
| `public/js/utils.js`, `public/js/icons.js` | Calendar formatting, safe rendering and local SVG icons |
| `public/data/programme.json` | Complete expanded 52-week seed, with all working targets |
| `public/data/exercises.json` | Full exercise catalogue |
| `public/data/test-protocols.json` | Test protocols and source-linked comparisons |
| `public/sw.js`, `public/manifest.webmanifest` | Offline cache and installation metadata |
| `scripts/` | Deterministic generators, report renderer, build, dev server and checks |
| `supabase/setup.sql` | Reviewable optional backend schema and policies |
| `tests/` | Progression, dates, programme, backups, sync and security-contract regression tests |
| `docs/` | Full readable programme, user guide, setup, schema and research notes |
| `vercel.json`, `netlify.toml` | Static hosting configuration |

## Verification and practical limits

The delivery includes executable tests for date coverage/DST, timing budgets, holiday exclusions, exact targets, deloads, no fabricated history, progression gates, missing-versus-zero metrics, variant isolation, backup round trips, atomic conflict comparison, network failure/retry and in-flight-edit preservation. Run `npm test` for the current results.

The dashboard was checked in a browser, including native IndexedDB persistence after a reload. See the delivery notes for the final checked flows. Supabase transport tests use a mock server; they do not establish that your future database has the SQL and Auth settings installed correctly. After connecting, use the dedicated-project smoke checks in the Supabase guide.

Browser data is not an encrypted vault and can be removed by clearing site data. Offline readiness requires the first complete online download. Audio/vibration and background timer execution depend on the operating system. A hand-operated stopwatch is not equivalent to timing gates. Forecasts do not certify safe footing or sufficient lighting.

External links, Supabase sign-in/sync and new weather forecasts require the internet. All training screens, seeded plans, logs, timers and backup tools work from the installed local assets.
