# SHIFT development workflow

Canonical GitHub repository: https://github.com/danieldhesiii/Hockey-training-app-

The branch and release rules below apply to this GitHub repository. A separate private ChatGPT preview may keep its own source repository and publishing workflow; it is not the GitHub production branch.

## Branch and release instructions

- Use `dev` for requested development changes and push completed, verified updates to `origin/dev`.
- Fetch and inspect the current repository and its instructions before applying updates. Preserve existing work and training data.
- Do not force-push. Only create, merge into, or push to `main` after the user explicitly approves that release.
- The user reviews `dev` locally and promotes it to `main` when ready. Vercel production deployment is a later user-controlled step.
- Keep credentials, local training logs, private runtime configuration and generated `dist/` out of Git.
- The optional ChatGPT-hosted preview has a separate hosting identity. Do not copy its `.openai/hosting.json` into this GitHub repository.

## Local work

Use Node 22 or newer. `npm install` verifies the dependency-free lockfile. `npm run dev` builds the current source and serves http://localhost:5173. After pulling updates, restart that command and accept the app's update prompt when shown. This server does not hot-reload source edits.

Run `npm run check`, `npm test` and `npm run build` before pushing code changes. For programme edits, run `npm run generate` first and include the updated JSON and readable programme in the commit.

## Training and data constraints

Preserve the 52-week dates, holiday exclusions, no Monday gym, 20-minute Thursday limit and inclusive 60-minute main gym budgets unless the user changes them. New exercises replace suitable slots. Preserve symptom gates and model-specific equipment instructions. Machine settings are not assumed to be kilograms; throws are not foot contacts; stationary running is not a timed track sprint.

Keep existing logged or edited session families unchanged when refreshing the baseline programme. New versions may update untouched future sessions. Never fabricate athlete results or delete training history during an app or programme update.

Use metric units, plain English and no em dash characters in user-facing content.
