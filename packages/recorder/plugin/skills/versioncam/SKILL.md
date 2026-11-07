---
name: versioncam
description: Record a short demo clip (a screencast, a short video, a GIF of a feature) of this repository's web app from one sentence of what it should show, and iterate until a reviewer passes it from a contact sheet. Use when someone asks to record, film or make a demo of a feature, or to set versioncam up in a repository. Works in any repository with a web app. The first run writes versioncam.config.ts, works out how to start the app, and proves the app records the same way twice before anything is authored. Also covers the repository's clips on version.cam (which are broken and why, fixing one, embedding one, who can see them, who gets an alert when one breaks, and the plan), with /versioncam status, /versioncam fix [clip] and /versioncam embed <clip>.
user-invocable: true
argument-hint: "\"<what the clip should show>\" [--id <slug>] [--max-rounds 6] | status | fix [clip] | embed <clip>"
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
the clip. A reviewer who has never seen how you wrote it looks at a picture of
it and says whether it shows what it claims. You go round again until it does,
or until the rounds run out.

Follow these steps in order. Three more files sit beside this one, in this
skill's directory: `onboarding.md`, `authoring.md` and `platform.md`. They
are briefs. Read each one when a step tells you to.

## Which brief

`/versioncam status`, `/versioncam fix [clip]`, `/versioncam embed <clip>`,
and any question about this repository's clips on version.cam (which are
broken, what plays meanwhile, who can see them, who gets an alert when one
breaks, the plan) are not a clip to record. Read `platform.md` and follow it instead
of the steps below. It sends you to step 0 when it needs the app's
directory, and back to `authoring.md` and steps 3 and 4 to fix a clip.

A bare `/versioncam`, with nothing after it, is not a clip to record either.
Say in two sentences what this skill does (it records a short video of this
repository's app from one sentence, checks it with a reviewer, and can keep
it on version.cam), ask what the clip should show, and run nothing.

Anything else is a clip to record, and so is a quoted sentence, whatever it
says (`/versioncam "Show the status page"`): go on with step 0.

## 0. Where, and which phase

Everything below runs in **the app's directory**: the one that holds
`versioncam.config.ts` (or `.js`, `.mjs`). That need not be the working
directory. In a monorepo, a session started at the repository root can run
this skill from an app's `.claude/skills/` further down, and one started
inside an app can run a skill installed above it. So before you decide
anything, look for the config in the whole repository, not only here.

**Find it.** Glob `**/versioncam.config.{ts,js,mjs}` from the top of the
repository (the directory holding `.git`), and leave out anything under
`node_modules/`, `.versioncam/` or `.claude/worktrees/` (a worktree there is
another checkout of the repository). What counts is the files on disk, committed or not. A first run's
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
If none has it, **stop** and tell the user to install it in the app's
directory first (`npm i -D versioncam`, then `npx versioncam install`). Every
step below runs `npx versioncam`. When nothing is installed, `npx` downloads
the latest published version. That is not necessarily the version this
repository will pin, and it has no Chromium to record with.

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
  `npx` then finds the app's versioncam by looking up from where you are.
  Each command then works as if it ran in the app's directory, so a relative
  path that you give it, or that it prints, is relative to that directory.
  Use absolute paths for your own `mkdir`, `cp` and files.

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
names the clip; without it, derive a slug from the intent: lowercase, hyphens,
at most 40 characters, cut at a word boundary. `--max-rounds <n>` defaults to 6.

```bash
mkdir -p .versioncam/author/<id>
npx versioncam doctor
```

`doctor` checks the machine and the config, and **starts the app** through the
config's `webServer` when nothing is serving it, then stops it again. Every
later command does the same, so you never start a dev server yourself. If the
app check fails, **stop** and say so. Nothing below works without the app, and
every round would waste a recording finding that out. If another check fails,
print it and stop too.

Then capture the start page once:

```bash
npx versioncam inspect /
```

## 2. Author, in this session

Read `authoring.md` now. It explains how to write and repair a clip, and it
applies to you. Then do what it says, in this order. Run `npx versioncam dsl`,
read the existing clips, and `inspect` every page the intent touches. Write
`.versioncam/author/<id>/beats.json`, write the clip, run `record --draft`,
then `review --beats …`, and repair. Use **at most three recordings**, then go
on to the sheet, whether the clip passed or not.

Write what the round produced to `.versioncam/author/<id>/round-N/author.md`:
the four things `authoring.md` asks for, including the paragraph on what was
awkward about the tools. That paragraph is the point of keeping these
directories; do not summarise it away. Copy `beats.json` beside it.

**Delegation.** If the first `inspect /` printed more than 400 lines, or your
host makes subagents cheap, hand the authoring to a subagent instead of doing
it here. Spawn a plain one (general-purpose) whose prompt is the full text of
`authoring.md`, followed by the intent, the clip id, the clips directory (the
config's `clips`), the `inspect /` output inline, the beats path, and the
app's directory, with the `--cwd` flag if step 0 had you use it. **Keep the
agent id it returns.** With that id and `SendMessage` you continue the same
author in later rounds, with everything it learned about the page still in its
context. A newly spawned one would start from nothing and repeat the same
recordings. Save its reply as `round-N/author.md`. You then orchestrate, and
the rest of this file is the same either way.

## 3. The sheet, then a fresh reviewer

```bash
npx versioncam sheet <id> --at-marks
```

`--at-marks` samples frame 0, each beat's settle mark, and the last frame,
instead of eight evenly spaced points, so the tiles the reviewer sees are the
beats, not whatever happened to fall on an eighth of the duration. It prints
the sheet's path, then the frame number behind each tile.

Give the reviewer only:

- the sheet path,
- **the frame numbers `sheet --at-marks` just printed**, in order, one per tile,
- the contents of `.versioncam/author/<id>/beats.json`,
- the clip id, so it can call `npx versioncam frame <id> <n>`. It runs that
  from this directory (name the directory if a subagent on your host starts
  somewhere else), with the `--cwd` flag on the end if step 0 had you use one.

The frame numbers are not optional. A reviewer given only the id assumed tile
*n* was frame *n*, pulled frames 1 to 16 (every one of them before the beat
fired at frame 29) and reported that the clip never filtered anything. It was
looking at the right clip and the wrong seconds. `sheet` prints the list for
exactly this reason; pass it on verbatim.

The reviewer's brief is `versioncam-reviewer.md`. It is in `agents/` two
levels up from this skill's directory when the skill came from the plugin, in
`.claude/agents/` when `versioncam init` installed it, and beside this file
when it was installed with `--into`. Use the first of these three options
that your host allows:

1. **Registered.** If an agent named `versioncam-reviewer` is available (it is
   `versioncam:versioncam-reviewer` when it came with the plugin), spawn it
   with those inputs. It cannot see anything else. It starts in a fresh
   context that holds the sheet and the beats, and nothing of how the clip was
   made. Its JSON says
   `"reviewer": "restricted"`.
2. **A plain subagent.** Otherwise, spawn a general-purpose subagent whose
   prompt is the full text of `versioncam-reviewer.md` followed by those
   inputs. Only its prompt keeps it from looking at the clip and your notes;
   nothing else stops it. Its JSON
   will still say `"restricted"`, because the file it was given says so; save
   it with `"reviewer": "unrestricted"`, which is what it was.
3. **No subagents.** Otherwise, read `versioncam-reviewer.md` and judge the
   sheet yourself, in a step of its own (*before* you look at your beats or
   your clip again, with only the four inputs in front of you) and save the
   verdict with `"reviewer": "self"`. The summary says so, because a clip that
   its own author passed is a weaker claim, and whoever reads it should know.

The reviewer is new every round on purpose. It must not see
the author's reasoning, an earlier verdict, or how hard the clip was to get
working. It sees only this round's picture. Never continue a reviewer, and never pass
it the author's report.

Save its JSON verbatim, with `reviewer` as above, as
`.versioncam/author/<id>/round-N/verdict.json`.

### If you think the verdict is wrong

You will sometimes believe a reviewer has erred, and sometimes you will be
right. **Do not override it.** Overriding it is the one move that undoes the
design. A fresh reviewer is trusted because it has not watched the clip being
built, and a session that has watched three rounds is the least independent
judge there is.

Get **one** second opinion, from a fresh reviewer on the same rung: same
sheet, same beats, same frame numbers, and nothing about the first verdict or
what you think it got wrong. Save it as `round-N/verdict-2.json`. That verdict
stands, whichever way it goes. If it agrees with the first, the clip has failed
and the round continues. If it disagrees, take it and move on, and keep both
files so the disagreement is on the record.

Get one second opinion, once per round. Two reviewers who disagree give you
information. A third would be shopping for the answer you wanted.

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

`reviewer` is the rung the passing verdict came from. Include `wallMs` only if you
can measure it. Leave it out rather than guess: a harness running you measures
it from outside. After a first run that found the app unstable, add
`"stable": false`.

Name the clip file and the rendered video, then go on to *Where it can live*.

### Where it can live

The clip is on disk. These steps take it to a permanent link, and each one
that changes something waits for the user's yes.

1. Find out whether the repository is on GitHub. It is when `.git/config` at
   the repository's root has a `[remote "origin"]` whose `url` names
   `github.com`. If it has none, say nothing about version.cam: tell the
   user the video on disk is the result, and stop.
2. Tell the user, in these words or close to them: "The video is at
   <path>. version.cam can host this clip at a permanent link,
   clips.version.cam/<owner>/<repo>/<id>, and keep it up to date every time
   you push to main. That needs GitHub Actions to record the clips on each
   push. Shall I add the workflow file?"
3. On yes: `npx versioncam ci`. Read what it printed, and pass it on in
   full. When `npm ci` is not enough to install the app, change the install
   step in the workflow to a command that is (the config's
   `webServer.command` and the app's package files tell you which). With the
   user's yes, commit the workflow together with the clip, the config and the
   skill files, as your host asks.
4. Then say: "If you sign in, I can show the project's status from here once
   the first run on main has finished: `npx versioncam cloud login`." On
   yes, run it as `platform.md` says under *Commands that wait*, and show
   the address and the code. The user approves it in the browser; you never
   do. Pass on everything the command prints after signing in, the beta
   sentence included, in the words it uses.
5. When `ci` said the repository is private, repeat its steps back in the
   same words and order, and stop at the step that says to email
   hello@version.cam. The user sends that email from their own address, not
   you. Say that once Pro is on, `/versioncam status` can show the project's
   status and the step to install the GitHub App.
6. Never send an email, never write to hello@version.cam yourself, never
   approve a code, and never change a plan.

## 5. If this was the last round

If the verdict failed and `N == max-rounds`, write `summary.json` with
`"passed": false` and the last verdict inline. Say which items failed, and
stop; in a headless run, say plainly in your final message that it failed.

Do not quietly raise `max-rounds`. A clip that has not converged in six rounds
tells you something about the intent or the tools. Writing that down is worth
more than grinding on.

## 6. Otherwise, fix it and go round again

Fix what the verdict names (the items that failed, read as written) and
nothing it did not name. If you delegated the authoring, use `SendMessage` with the
id you kept to send the author the verdict JSON **verbatim** (not summarised,
not reordered, not softened), with this instruction: fix the failing items,
re-record in draft, run `npx versioncam review`, and return. Add no opinion of
your own. The reviewer has looked at the clip in a way you have not, and the
author trusts the verdict because it comes from a reviewer and is not your
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

`.versioncam/` is gitignored. It is a build product, and none of it gets
committed. The clip is different: it lives in the clips directory, and it is
the thing worth reading and keeping. Commit nothing without the person's yes;
that is their call.
