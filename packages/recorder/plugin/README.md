# The versioncam skill

`/versioncam "<what the clip should show>"` records a clip of your web app: it
writes the script, records it, has a reviewer look at the result, and fixes
what the reviewer finds — until the reviewer passes it or the rounds run out.
The first time it runs in a repository, it sets the repository up first.

Nothing here calls an API. The model is whichever agent session runs the
skill, and the vision step is that session's file reader opening a contact
sheet. Everything is markdown, and you can edit all of it.

## Install

The skill ships inside the `versioncam` npm package:

```bash
npx versioncam init        # .claude/skills/versioncam/ and .claude/agents/versioncam-reviewer.md
```

`init` installs the skill and nothing else — no config: the first run writes
that. It refuses to overwrite a file that is already there, and refuses the
whole install if any one is; `--force` overwrites. For an agent host that reads
skills from somewhere other than `.claude/`, `--into <dir>` puts the skill
directory at `<dir>/versioncam/`, with the reviewer inside it.

Or, without copying anything, load the plugin directory as it is:

```bash
claude --plugin-dir node_modules/versioncam/plugin
```

## Run it

```
/versioncam "Create a shipment for a new recipient and show it appearing in the list"
/versioncam "Find a shipment by filtering the list" --id 02-find --max-rounds 4
```

## What it does

**The first run** — no `versioncam.config.ts` in the directory — sets the
repository up (`skills/versioncam/onboarding.md`): it works out how the app
starts and where it is served, from `package.json`, the framework's config and
the README, and asks when there is more than one plausible answer; asks whether
the app signs in and how you want that handled; writes the config, with a
`webServer` so every command starts the app itself; runs `doctor` and
`inspect` to prove the app starts and settles; and records a three-second clip
twice with `stability`, to prove the app records the same way twice before a
clip is written for it. Nothing is committed.

**Every run** then (`skills/versioncam/SKILL.md`):

1. `versioncam doctor` — which starts the app — and `inspect /`.
2. The session writes the clip itself, following
   `skills/versioncam/authoring.md`: it reads `versioncam dsl` and the existing
   clips, writes a beat sheet, writes the clip, records it in draft, and runs
   the deterministic checks in `versioncam review`. Three recordings at most,
   then on. On a page too big to hold in context, it hands this to a subagent
   and keeps that subagent for later rounds.
3. A contact sheet sampled at the beats, and a **fresh reviewer** on it — one
   picture, a five-item checklist, a JSON verdict. Fresh every round,
   deliberately: it sees the clip, never the argument for it.
4. On a pass, a full-quality record and render. Otherwise the fixes the verdict
   names, and another round.

The reviewer is `agents/versioncam-reviewer.md`, one file used three ways:
registered as an agent, which is what Claude Code does with it; as the prompt
of a plain subagent, on a host that cannot register agents; or as a checklist
the session applies to its own sheet, on a host with no subagents at all. The
verdict records which, as `"reviewer": "restricted"`, `"unrestricted"` or
`"self"` — a clip passed by its own author is a weaker claim, and says so.

The skill never runs `git`. The clip it writes lands in your clips directory as
an ordinary file, for you to read and commit yourself.

## What it leaves behind

```
.versioncam/author/<id>/
  beats.json              the beat sheet: { label, expect } per beat
  summary.json            { id, rounds, passed, wallMs, reviewer }
  <id>-sheet.png          the final contact sheet
  round-1/
    author.md             what the round produced, including what was awkward
    beats.json
    verdict.json          the reviewer's JSON, verbatim
  round-2/ …
```

`.versioncam/` is a build product and is gitignored. Keep the clip; the
transcripts are for reading when something goes wrong, and for finding the
next thing to fix in the recorder — the paragraph on awkward tooling is there
because the first agent to write one produced a list that became a work
package.

## What it costs

On the example app, headless, with WP5's two-agent version of this loop: one
clip took between six and twelve minutes, in one or two rounds, and all six
intents across two apps passed. Most of the time is model latency rather than
the recorder: a round is a handful of recordings of a few seconds each, and a
reviewer's single look at a single picture still takes a minute or two end to
end. It runs on a subscription rather than a metered key, so the setup cost is
close to zero; for anything higher-volume the prompts in these files are what
would move to a direct SDK loop, unchanged.
