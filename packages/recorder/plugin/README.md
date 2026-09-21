# The authoring loop, as a Claude Code plugin

`/demos-author "<what the clip should show>"` writes a clip of your running
app, records it, looks at the result, and fixes what it finds — until a
reviewer passes it or it runs out of rounds.

Nothing here calls an API. The "model" is whichever Claude Code session runs
the skill, and the vision step is the `Read` tool opening a contact sheet. The
agents are markdown files: their bodies are their system prompts, and you can
edit them.

## Install

The plugin ships inside the recorder's npm package. Point Claude Code at it:

```bash
claude --plugin-dir node_modules/@living-demos/recorder/plugin
```

Or copy the skill and the agents into your repository, if you would rather
have files you can edit and commit:

```bash
npx demos init --claude      # writes .claude/agents/ and .claude/skills/
```

`init` refuses to overwrite a file that already exists; `--force` overwrites.
Either way, the skill needs `@living-demos/recorder` installed,
`recorder.config.ts` in the working directory, and **the app running** at the
config's `baseUrl`.

## Run it

```
/demos-author "Create a shipment for a new recipient and show it appearing in the list"
/demos-author "Find a shipment by filtering the list" --id 02-find --max-rounds 4
```

## What the loop does

1. `demos doctor`, and stops if the app is unreachable.
2. Spawns **`demo-author`**, with the intent and a fresh `demos inspect` of the
   start page. It reads `demos dsl` and your existing clips, writes a beat
   sheet, writes the clip, records it in draft, runs the deterministic checks
   in `demos review`, and repairs what fails. Three recordings at most before
   it hands back what it has.
3. Renders an eight-tile contact sheet at the beats, and spawns a **fresh
   `demo-reviewer`** on it — one picture, a five-item checklist, a JSON
   verdict. Fresh every round, deliberately: it sees the clip, never the
   argument for it.
4. On a pass: a full-quality record and render. Otherwise the verdict goes back
   to the *same* author, which still has the page in its context, and the round
   repeats.

The author has no `git` and no `Agent` tool: it cannot commit and it cannot
spawn anything. The clip it writes lands in your clips directory as an ordinary
file, for you to read and commit yourself.

## What it leaves behind

```
.demos/author/<id>/
  beats.json              the beat sheet: { label, expect } per beat
  summary.json            { id, rounds, passed, wallMs }
  round-1/
    author.md             what the author returned, including what it found awkward
    beats.json
    verdict.json          the reviewer's JSON, verbatim
  round-2/ …
```

`.demos/` is a build product and is gitignored. Keep the clip; the transcripts
are for reading when something goes wrong, and for finding the next thing to
fix in the recorder — the `author.md` paragraph on awkward tooling is there
because the first agent to write one produced a list that became a work
package.

## What it costs

Honestly: **about fifteen minutes and four recordings for one clip**, measured
on the pilot that this loop was built from — 41 tool calls, roughly 184k
tokens, converging on a clip that satisfied its intent with every locator by
test id or role and no app source read.

Most of that is the harness rather than the recorder; the pilot's tool calls
averaged 23 seconds each. The reviewer is a single look at a single picture and
still costs a couple of minutes end to end. If that is too slow for you, the
levers in order are `effort` on the reviewer, `omitClaudeMd` (already set on
both agents), and fewer rounds — not a shorter checklist.

It runs on a Claude subscription rather than a metered key, so the setup cost
is close to zero. For internal clips that trade is fine. For anything
higher-volume it is the wrong shape, and the prompts in these two files are
what would move to a direct SDK loop unchanged.
