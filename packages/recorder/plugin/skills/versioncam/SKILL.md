---
name: versioncam
description: Record a short demo clip — a screencast, a short video, a GIF of a feature — of this repository's web app from one sentence of what it should show, and iterate until a reviewer passes it from a contact sheet. Use when someone asks to record, film or make a demo of a feature, or to set versioncam up in a repository. Works in any repository with a web app — the first run writes versioncam.config.ts, works out how to start the app, and proves the app records the same way twice before anything is authored.
user-invocable: true
argument-hint: "\"<what the clip should show>\" [--id <slug>] [--max-rounds 6]"
allowed-tools:
  - Agent
  - SendMessage
  - AskUserQuestion
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(npx versioncam *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Bash(ls *)
---

# Record a demo clip

`$ARGUMENTS`

You turn one sentence into a clip: a script in this repository that drives the
running app through its own controls, and a video recorded from it. You write
the clip; a reviewer who has never seen how it was written looks at a picture
of it and says whether it shows what it claims; and you go round again until it
does, or the rounds run out.

Follow these steps in order. Two more files sit beside this one, in this
skill's directory: `onboarding.md` and `authoring.md`. They are briefs, read
when a step says to.

## 0. Where, and which phase

Everything below runs in **the app's directory**: the one that holds
`versioncam.config.ts` (or `.js`, `.mjs`). That need not be the working
directory. In a monorepo, a session started at the repository root can run
this skill from an app's `.claude/skills/` further down, and one started
inside an app can run a skill installed above it. So before deciding
anything, find the config, in the whole repository rather than only here.

**Find it.** Glob `**/versioncam.config.{ts,js,mjs}` from the top of the
repository (the directory holding `.git`), and leave out anything under
`node_modules/`, `.versioncam/` or `.claude/worktrees/`, which is another
checkout. Files on disk are what count, committed or not: a first run's
config may not be committed yet, and a deleted one is gone.

- **One** → its directory is the app's directory.
- **Several** → ask which app with `AskUserQuestion`, listing their
  directories, unless the request already names one. With no one to ask,
  stop and list them.
- **None** → this is the first run, and the config goes where
  `versioncam init` put this skill. This skill's directory is
  `${CLAUDE_SKILL_DIR}` (if that is not a path, it is the directory you read
  this file from). If it is `<dir>/.claude/skills/versioncam` inside this
  repository, the app's directory is `<dir>`. Otherwise it is the working
  directory.

**Check versioncam is installed** where the app will find it: `ls -d
<the app's directory>/node_modules/versioncam`, then the same in each
directory above it up to the repository root, since a workspace hoists it.
If none has it, **stop** and say it must be installed in the app's directory
first (`npm i -D versioncam`, then `npx versioncam install`). Every step below
runs `npx versioncam`, and `npx` with nothing installed downloads the latest
published version: not necessarily the one this repository will pin, and
with no Chromium to record with.

**Go there**, if the app's directory is not the working directory, and say in
one line which directory it is:

- **Below where this session started** (a session at the repository root):
  `cd` into it by its absolute path. The shell stays there for every later
  command, and a subagent you spawn starts there too. Do not reach it with
  `--cwd` from above: `npx` looks for versioncam in the directory it runs in
  and in those above it, never below, so it would not run the app's own.
- **Anywhere else** (a session started inside the app, below its config): a
  session cannot `cd` out of the directory it started in. Put `--cwd <the
  app's directory>` on the end of every `npx versioncam` command instead.
  `npx` then finds the app's versioncam by looking up from where you are,
  and each command works as if run in the app's directory, so a relative path
  you give it, or it prints, is that directory's. Your own `mkdir`, `cp` and
  files take absolute paths.

If a `cd` does not stay (a later `pwd` prints where you started), begin each
command with `cd <the app's directory> && ` instead. Either way, tell each
subagent you spawn the app's directory and how you are running commands
there.

Then, did you find a config?

- **No** → this is the repository's first run. Read `onboarding.md` and do all
  of it, then continue with step 1.
- **Yes** → continue with step 1.

## 1. Set up

Parse `$ARGUMENTS`. The first quoted string is the **intent**. `--id <slug>`
names the clip; without it, derive a slug from the intent — lowercase, hyphens,
at most 40 characters, cut at a word boundary. `--max-rounds <n>` defaults to 6.

```bash
mkdir -p .versioncam/author/<id>
npx versioncam doctor
```

`doctor` checks the machine and the config, and **starts the app** through the
config's `webServer` when nothing is serving it, then stops it again. Every
later command does the same, so you never start a dev server yourself. If the
app check fails, **stop** and say so: nothing below works without the app, and
every round would spend a recording discovering that. If another check fails,
print it and stop too.

Then capture the start page once:

```bash
npx versioncam inspect /
```

## 2. Author — this session

Read `authoring.md` now: it is how to write and repair a clip, and it applies
to you. Then, as it says: `npx versioncam dsl`, the existing clips, `inspect`
of every page the intent touches; write `.versioncam/author/<id>/beats.json`;
write the clip; `record --draft`; `review --beats …`; repair — **at most three
recordings**, then on to the sheet, passed or not.

Write what the round produced to `.versioncam/author/<id>/round-N/author.md` —
the four things `authoring.md` asks for, including the paragraph on what was
awkward about the tools. That paragraph is the point of keeping these
directories; do not summarise it away. Copy `beats.json` beside it.

**Delegation.** If the first `inspect /` printed more than 400 lines, or your
host makes subagents cheap, hand the authoring to a subagent instead of doing
it here. Spawn a plain one (general-purpose) whose prompt is the full text of
`authoring.md`, followed by the intent, the clip id, the clips directory (the
config's `clips`), the `inspect /` output inline, the beats path, and the
app's directory, with the `--cwd` flag if step 0 had you use it. **Keep the
agent id it returns**: that id is how you continue the same author in later
rounds, with `SendMessage`, everything it learned about the page still in its
context — spawning a new one would start from nothing and repeat the same
recordings. Save its reply as `round-N/author.md`. You then orchestrate; the
rest of this file is the same either way.

## 3. The sheet, then a fresh reviewer

```bash
npx versioncam sheet <id> --at-marks
```

`--at-marks` samples frame 0, each beat's settle mark, and the last frame,
instead of eight evenly spaced points — so the tiles the reviewer sees are the
beats, not whatever happened to fall on an eighth of the duration. It prints
the sheet's path, then the frame number behind each tile.

The reviewer is given only:

- the sheet path,
- **the frame numbers `sheet --at-marks` just printed**, in order, one per tile,
- the contents of `.versioncam/author/<id>/beats.json`,
- the clip id, so it can call `npx versioncam frame <id> <n>`: from this
  directory, which you name if a subagent on your host starts somewhere
  else, and with the `--cwd` flag on the end if step 0 had you use one.

The frame numbers are not optional. A reviewer given only the id assumed tile
*n* was frame *n*, pulled frames 1 to 16 — every one of them before the beat
fired at frame 29 — and reported that the clip never filtered anything. It was
looking at the right clip and the wrong seconds. `sheet` prints the list for
exactly this reason; pass it on verbatim.

The reviewer's brief is `versioncam-reviewer.md`: in `agents/` two levels up
from this skill's directory when the skill came from the plugin, in
`.claude/agents/` when `versioncam init` installed it, and beside this file
when it was installed with `--into`. Take the first rung of this ladder your
host allows:

1. **Registered.** If an agent named `versioncam-reviewer` is available — it is
   `versioncam:versioncam-reviewer` when it came with the plugin — spawn it
   with those inputs. It is blind by construction: a fresh context holding the
   sheet and the beats and nothing of how the clip was made. Its JSON says
   `"reviewer": "restricted"`.
2. **A plain subagent.** Otherwise, spawn a general-purpose subagent whose
   prompt is the full text of `versioncam-reviewer.md` followed by those
   inputs. It is blind by instruction rather than by construction. Its JSON
   will still say `"restricted"`, because the file it was given says so; save
   it with `"reviewer": "unrestricted"`, which is what it was.
3. **No subagents.** Otherwise, read `versioncam-reviewer.md` and judge the
   sheet yourself, in a step of its own — *before* you look at your beats or
   your clip again, with only the four inputs in front of you — and save the
   verdict with `"reviewer": "self"`. The summary says so: a clip passed by its
   own author is a weaker claim, and whoever reads it should know.

A fresh reviewer every round is the point, not an accident. It must not see
the author's reasoning, an earlier verdict, or how hard the clip was to get
working — only this round's picture. Never continue a reviewer, and never pass
it the author's report.

Save its JSON verbatim, with `reviewer` as above, as
`.versioncam/author/<id>/round-N/verdict.json`.

### If you think the verdict is wrong

You will sometimes believe a reviewer has erred, and sometimes you will be
right. **Do not override it.** Overriding is the one move that undoes the
design: a fresh reviewer is trusted precisely because it has not watched the
clip being built, and a session that has watched three rounds is the least
independent judge available.

Get **one** second opinion, from a fresh reviewer on the same rung — same
sheet, same beats, same frame numbers, and nothing about the first verdict or
what you think it got wrong. Save it as `round-N/verdict-2.json`. That verdict
stands, whichever way it goes. If it agrees with the first, the clip has failed
and the round continues; if it disagrees, take it and move on, and keep both
files so the disagreement is on the record.

One second opinion, once per round. Two reviewers who disagree is information.
A third is shopping for the answer you wanted.

## 4. If the verdict passes

Take the real recording and render it:

```bash
npx versioncam record <id>
npx versioncam render <id>
npx versioncam sheet <id> --at-marks
```

Copy that final sheet into `.versioncam/author/<id>/`. Write
`.versioncam/author/<id>/summary.json`:

```json
{ "id": "<id>", "rounds": 2, "passed": true, "wallMs": 812000, "reviewer": "restricted" }
```

`reviewer` is the rung the passing verdict came from. `wallMs` only if you can
measure it — leave it out rather than guess; a harness running you measures it
from outside. After a first run that found the app unstable, add
`"stable": false`.

Name the clip file and the rendered video, and stop.

## 5. If this was the last round

If the verdict failed and `N == max-rounds`, write `summary.json` with
`"passed": false` and the last verdict inline. Say which items failed, and
stop; in a headless run, say plainly in your final message that it failed.

Do not quietly raise `max-rounds`. A clip that has not converged in six rounds
is a finding about the intent or the tools, and it is worth more written down
than ground out.

## 6. Otherwise — fix it, and go round again

Fix what the verdict names — the items that failed, read as written — and
nothing it did not name. When the authoring is delegated, send the author the
verdict JSON **verbatim** with `SendMessage`, by the id you kept — not
summarised, not reordered, not softened — and the instruction: fix the failing
items, re-record in draft, run `npx versioncam review`, and return. Add no
opinion of your own: the reviewer has looked at the clip in a way you have
not, and the author trusts the verdict because it is a reviewer's and not a
relayed impression.

Re-record in draft, run `review`, make `.versioncam/author/<id>/round-N/` for
the new round with its `author.md` and `beats.json`, and go back to step 3.

## What this leaves behind

```
.versioncam/author/<id>/
  beats.json
  summary.json              { id, rounds, passed, wallMs?, reviewer }
  <id>-sheet.png            the final sheet
  round-1/  author.md  beats.json  verdict.json  (verdict-2.json)
  round-2/  …
```

`.versioncam/` is gitignored — a build product, none of it to be committed. The
clip is not: it lives in the clips directory and is the thing worth reading and
keeping. You commit nothing; that is the person's call.
