# Versioncam, notes for agents working in this repository

Versioncam (`version.cam`) records short, true product videos. A clip is a
script in the consuming app's repository; the recorder drives a real browser
through it on an authored clock, a reviewer judges the result from a contact
sheet, and CI re-records every clip so a demo that no longer matches the app
fails instead of quietly lying.

**This repository is public.** It holds the recorder, the example app and
the evaluation harness, and nothing else. The hosted layer at version.cam is
a separate, private repository, and nothing from it belongs here: no plan,
no path under anyone's home directory, no credential, no account id. Commits
are authored and committed with a GitHub noreply address, never a personal
one. `packages/recorder/src/published.test.ts` holds what the published
package may mention; read it before adding a name or a link to anything that
ships.

## Layout

| Path | What |
|---|---|
| `packages/recorder` | the package: `src/` (driver, capture gate, renderer, review, CLI in `src/cli`), `bin/` (the committed launcher), `plugin/` (the authoring skill, `SKILL.md`, `authoring.md`, `onboarding.md`, and its reviewer), `dsl.md` (the DSL reference a reflection test keeps honest), unit tests beside the code as `*.test.ts`, integration tests in `test/` |
| `examples/demo-app` | a deliberately boring Vite app with three clips: the proof the package works from outside itself, and what CI records on every push. Serves on **5174** |
| `scripts/` | the headless eval harness for the authoring skill (`author-eval.sh`, `onboard-eval.sh`) |

## Commands, from the repository root

```bash
npm ci && npm run build && npm run typecheck && npm run lint && npm test
npx versioncam install --with-deps && npm run test:integration
```

All five gates green before any push; CI runs the same five plus the example
app's `check`, `test:gate` and `render --sequence`, and on a push to `main`
publishes the example's recordings to version.cam and its renders to the
front page. In the example app the CLI is `npx versioncam ...`.

An app elsewhere on this machine that needs a build not yet on npm installs a
tarball, never a link: `npm pack` in `packages/recorder`, then
`npm i -D <path>/versioncam-<version>.tgz` in the app. A tarball is exactly
what npm would deliver; a link resolves the package's dependencies from this
repository instead, and hides anything `files` leaves out of the tarball.

## Conventions

- **Comments say why**, at the density of the surrounding code. This code is
  unusually well commented on purpose: a function whose comment could not
  explain why it exists is not finished.
- **Commits:** imperative subject; a body that says what changed and why; one
  concern per commit. Work lands on `main`. A release is the version bump on
  `main` and a `vX.Y.Z` tag on that commit, which `release.yml` publishes.
- **Never `git add -A`.** Name the files.
- **Never regenerate a golden or fixture recording** to make a test pass, and
  never loosen a byte-identity assertion. If two runs differ, find out why.
- **When a clip will not reproduce, record it twice the same way first.**
  `npx versioncam stability <id>` does exactly that and saves the two frames
  that differ. If the two differ, the app has something that does not run on
  authored time; if they match, suspect the recorder. (README,
  *Determinism*.)
- `dsl.md` and the DSL class must agree; `test/dsl.spec.ts` checks it. A new
  public method on `RecordingSession` goes into `dsl.md` or into that test's
  exclusion list, deliberately.
- **No long dashes** in anything a reader sees: the READMEs, `dsl.md`, the
  skill, the changelog, CLI messages. A sentence ends, or a colon or a
  bracket does the work. `published.test.ts` checks the shipped docs.
- Recordings, renders, transcripts and sessions are build products:
  `.versioncam/`, `.env*`, `**/.auth/`, `*.har` are gitignored and stay that
  way.
- On zsh, quote globs (`grep --include='*.md'`), or the shell expands them
  before `grep` sees them. And zsh does not word-split an unquoted `$VAR`,
  so `sed -i '' ... $FILES` hands sed one argument with newlines in it and
  changes nothing; pipe `git grep -lz ...` into `xargs -0` instead.

## The eval harness

`scripts/*-eval.sh` launch `claude -p`. **Claude Code will not launch inside a
Claude Code session**, so a person runs the evals from a plain terminal and a
session cannot; a plan that needs them says so and stops there. The JSON
results go to `.versioncam/evals/<date>/`; the per-round transcripts land in
the example app's `.versioncam/author/<id>/`. Both are build products and
stay out of git.
