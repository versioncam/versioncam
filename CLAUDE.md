# Versioncam — notes for agents working in this repository

Versioncam (`version.cam`) records short, true product videos. A clip is a
script in the consuming app's repository; the recorder drives a real browser
through it on an authored clock, a reviewer judges the result from a contact
sheet, and CI re-records every clip so a demo that no longer matches the app
fails instead of quietly lying. The master plan is [`docs/plan.md`](docs/plan.md);
each work package has its own execution record, `docs/wp*.md`. Read the
plan's sections 1–3 and the current work package before changing code.

## Layout

| Path | What |
|---|---|
| `packages/recorder` | the package — `src/` (driver, capture gate, renderer, review, CLI in `src/cli`), `bin/` (the committed launcher), `plugin/` (the Claude Code skill and agents), `dsl.md` (the DSL reference a reflection test keeps honest), unit tests beside the code as `*.test.ts`, integration tests in `test/` |
| `examples/demo-app` | a deliberately boring Vite app with three clips: the proof the package works from outside itself. Serves on **5174** |
| `docs/` | `plan.md`, the `wp*.md` records, `evals/<date>/` results |
| `scripts/` | the headless eval harness (`author-eval.sh`, `pathgen-eval.sh`) |

## Commands, from the repository root

```bash
npm ci && npm run build && npm run typecheck && npm run lint && npm test
npx playwright install chromium && npm run test:integration
```

All five gates green before any push; CI runs the same five plus the example
app's `check`, `test:gate` and `render --sequence`. In the example app the
CLI is `npx versioncam …` (until WP6 Part I lands it is still `npx demos …`).

## Conventions

- **Comments say why**, at the density of the surrounding code. This code is
  unusually well commented on purpose: a function whose comment could not
  explain why it exists is not finished.
- **Commits:** imperative subject; a body that says what changed and why; one
  concern per commit. Work lands on `main`; each work-package part gets a tag
  (`wp1-speed`, `wp2-package`, `wp5-author`, …); push after each part.
- **Never `git add -A`.** Name the files.
- **Never regenerate a golden or fixture recording** to make a test pass, and
  never loosen a byte-identity assertion. If two runs differ, find out why.
- **When a clip will not reproduce, record it twice the same way first.** If
  the two differ, the app has something that does not run on authored time;
  if they match, suspect the recorder. (README, *Determinism*.)
- `dsl.md` and the DSL class must agree — `test/dsl.spec.ts` checks it. A new
  public method on `RecordingSession` goes into `dsl.md` or into that test's
  exclusion list, deliberately.
- Recordings, renders, transcripts and sessions are build products:
  `.demos/` → `.versioncam/` after WP6, `.env*`, `**/.auth/`, `*.har` are
  gitignored and stay that way.
- The shell on the development machine is **zsh**: quote globs
  (`grep --include='*.md'`), or `zsh` expands them before `grep` sees them.

## The eval harness

`scripts/*-eval.sh` launch `claude -p`. **Claude Code will not launch inside a
Claude Code session**, so a person runs the evals from a plain terminal and a
session cannot — a plan that needs them says so and stops there. Results go
to `docs/evals/<date>/`; the per-round transcripts land in the app's
`.versioncam/author/<id>/` (`.demos/…` before WP6).

## PathGen, the first consumer

`~/Documents/projects/pathgen app/frontend/surveillance-dashboard/demos/` is
a workspace that consumes this package by `npm link`, on PathGen's branch
`feat/demos-package`. That repository has its own rules (`AGENTS.md` there),
and the ones that bind work from here: **no commit without Peter's explicit
approval of that commit; never `git add -A`; never read values from or touch
its `.env*` files; never commit `.demos/`, `.versioncam/` or
`.env.recording`; `make start` runs the stack and one client per DuckDB
session — a stale `.wal` makes the next connection fail with
`Table with name "samples" already exists`; never edit files while a
recording runs** (Vite reloads the page being recorded).

## Git identity on Peter's machine

Commits here are authored `92371345+petbul@users.noreply.github.com` (repo-local config) and
pushes authenticate as `petbul` through a repo-local credential helper.
PathGen commits as `peter-ixo`. Do not run `gh auth switch` and do not change
either repository's remote or credential configuration.
