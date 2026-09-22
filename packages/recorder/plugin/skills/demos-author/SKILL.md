---
name: demos-author
description: Write a demo clip of the running app from a sentence of intent, then iterate until it records cleanly and a reviewer passes it from the contact sheet. Use in a repository that has recorder.config.ts and @living-demos/recorder, when someone asks for a demo clip, a screencast or a short video of a feature. The app must be running at the config's baseUrl.
user-invocable: true
argument-hint: "\"<what the clip should show>\" [--id <slug>] [--max-rounds 6]"
allowed-tools:
  - Agent
  - Read
  - Write
  - SendMessage
  - Bash(npx demos *)
  - Bash(mkdir *)
  - Bash(cp *)
---

# Author a demo clip

`$ARGUMENTS`

You run a loop. Two subagents do the work: `demo-author` writes and repairs the
clip, `demo-reviewer` looks at a picture of it and says whether it is
watchable. You spawn them, carry verdicts between them, and decide when to
stop. Do not write or fix the clip yourself — the author has the page in its
context and you do not.

Follow these steps in order.

## 0. Set up

Parse `$ARGUMENTS`. The first quoted string is the **intent**. `--id <slug>`
names the clip; without it, derive a slug from the intent — lowercase, hyphens,
at most 40 characters, no trailing hyphen. `--max-rounds <n>` defaults to 6.

```bash
mkdir -p .demos/author/<id>
npx demos doctor
```

`doctor` reports node, chromium, ffmpeg, the config and whether the app answers
at `baseUrl`. If the app is unreachable, **stop** and say so: nothing below
works without a running app, and every round would burn a subagent to discover
that. If a check other than the app fails, print it and stop too.

Then capture the start page once, for the author's opening context:

```bash
npx demos inspect /
```

## 1. Round 1 — spawn the author

Spawn the `demo-author` agent. Give it, in the prompt:

- the intent, verbatim;
- the clip id;
- the clips directory (from `recorder.config.ts` — the `clips` glob);
- the full output of `npx demos inspect /`, inline, not a path;
- the beats path it must write: `.demos/author/<id>/beats.json`.

Tell it to work until `npx demos record --draft <id>` succeeds **and**
`npx demos review <id> --beats .demos/author/<id>/beats.json` passes, then
return.

**Keep the agent id it returns.** That id is how you continue this same author
in later rounds, with everything it learned about the page still in its
context. Spawning `demo-author` again instead would start from nothing and
repeat the same three recordings.

When it returns, copy its work into the round directory:

```bash
mkdir -p .demos/author/<id>/round-1
cp .demos/author/<id>/beats.json .demos/author/<id>/round-1/
```

Save the author's returned text as `.demos/author/<id>/round-1/author.md`,
including its paragraph on what was awkward about the tools. That paragraph is
the point of keeping these directories; do not summarise it away.

## 2. Every round — the sheet, then a fresh reviewer

```bash
npx demos sheet <id> --at-marks
```

`--at-marks` samples frame 0, each beat's settle mark, and the last frame,
instead of eight evenly spaced points — so the tiles the reviewer sees are the
beats, not whatever happened to fall on an eighth of the duration. It prints
the sheet's path.

Spawn a **new** `demo-reviewer` for this round. Give it only:

- the sheet path,
- **the frame numbers `sheet --at-marks` just printed**, in order, one per tile,
- the contents of `.demos/author/<id>/beats.json`,
- the clip id (so it can call `npx demos frame <id> <n>`).

The frame numbers are not optional. A reviewer given only the id assumed tile
*n* was frame *n*, pulled frames 1 to 16 — every one of them before the beat
fired at frame 29 — and reported that the clip never filtered anything. It was
looking at the right clip and the wrong seconds. `sheet` prints the list for
exactly this reason; pass it on verbatim.

A fresh reviewer every round is the point, not an accident. It must not see
the author's reasoning, its earlier verdict, or how hard the clip was to get
working — only this round's picture. Never continue a reviewer, and never pass
it the author's report.

Save its JSON verbatim as `.demos/author/<id>/round-N/verdict.json`.

## 2a. If you think the verdict is wrong

You will sometimes believe a reviewer has erred, and sometimes you will be
right. **Do not override it.** Overriding is the one move that undoes the
design: a fresh reviewer is trusted precisely because it has not watched the
clip being built, and an orchestrator who has watched three rounds is the least
independent judge available.

Spawn **one** more `demo-reviewer`, fresh, for a second opinion — same sheet,
same beats, same frame numbers, and nothing about the first verdict or what you
think it got wrong. Save it as `round-N/verdict-2.json`. That verdict stands,
whichever way it goes. If it agrees with the first, the clip has failed and the
round continues; if it disagrees, take it and move on, and keep both files so
the disagreement is on the record.

One second opinion, once per round. Two reviewers who disagree is information.
A third is shopping for the answer you wanted.

## 3. If the verdict passes

Take the real recording and render it:

```bash
npx demos record <id>
npx demos render <id>
npx demos sheet <id> --at-marks
```

Copy that final sheet into `.demos/author/<id>/`. Write
`.demos/author/<id>/summary.json`:

```json
{ "id": "<id>", "rounds": 3, "passed": true, "wallMs": 812000 }
```

Print the summary, name the clip file and the rendered video, and stop.

## 4. If this was the last round

If the verdict failed and `N == max-rounds`, write `summary.json` with
`"passed": false` and the last verdict inline. Print it, say which items
failed, and stop. In a headless run, exit non-zero.

Do not quietly raise `max-rounds`. A clip that has not converged in six rounds
is a finding about the intent or the tools, and it is worth more written down
than ground out.

## 5. Otherwise — send the verdict back

Send the author a message — the same author, by the agent id you kept — with:

- the verdict JSON **verbatim**, not summarised, not reordered, not softened;
- the instruction: fix the failing items, re-record in draft, run
  `npx demos review`, and return.

Do not add your own opinion of the clip. You have not seen it; the reviewer
has, and the author trusts the verdict because it is a reviewer's and not a
relayed impression.

Increment N, make `.demos/author/<id>/round-N/`, copy the author's new report
and beats into it, and go back to step 2.

## What this leaves behind

```
.demos/author/<id>/
  beats.json
  summary.json
  <id>-sheet.png            the final sheet
  round-1/  author.md  beats.json  verdict.json
  round-2/  …
```

`.demos/` is gitignored — it is a build product, and none of it should be
committed. The clip file the author wrote is not: it lives in the clips
directory and is the thing worth reviewing and keeping.
