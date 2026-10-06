# The versioncam skill

`/versioncam "<what the clip should show>"` records a clip of your web app. It
writes the script, records it, has a reviewer look at the result, and fixes
what the reviewer finds. It stops when the reviewer passes the clip or the
rounds run out. The first time it runs in a repository, it sets the
repository up first.

Nothing here calls a model's API. The model is whichever agent session runs
the skill, and the vision step is that session's file reader opening a
contact sheet. Everything is markdown, and you can edit all of it.

## Install

The skill ships inside the `versioncam` npm package:

```bash
npx versioncam init        # .claude/skills/versioncam/ and .claude/agents/versioncam-reviewer.md
```

`init` installs the skill and nothing else, not even a config: the first run
writes that. It refuses to overwrite a file that is already there, and
refuses the whole install if any one is. `--force` overwrites. For an agent
host that reads skills from somewhere other than `.claude/`, `--into <dir>`
puts the skill directory at `<dir>/versioncam/`, with the reviewer inside it.

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

**The first run**, in a repository with no `versioncam.config.ts`, sets it
up (`skills/versioncam/onboarding.md`):

1. It works out how the app starts and where it is served, from
   `package.json`, the framework's config and the README. When there is more
   than one plausible answer, it asks.
2. It asks whether the app signs in, and how you want that handled.
3. It writes the config, with a `webServer` so every command starts the app
   itself.
4. It runs `doctor` and `inspect` to prove the app starts and settles.
5. It records a three-second clip twice with `stability`, to prove the app
   records the same way twice before a clip is written for it.

Nothing is committed.

**In a monorepo** the skill first looks for `versioncam.config.ts` across the
whole repository, wherever the session started, and then works in the
directory that holds it. With several apps, it asks which. With none, the
first run writes the config where `versioncam init` put the skill.

**Every run** then goes like this (`skills/versioncam/SKILL.md`):

1. `versioncam doctor`, which starts the app, and `inspect /`.
2. The session writes the clip itself, following
   `skills/versioncam/authoring.md`. It reads `versioncam dsl` and the
   existing clips, writes a beat sheet, writes the clip, records it in draft,
   and runs the checks in `versioncam review`. Three recordings at most, then
   it moves on. On a page too big to hold in context, it hands this step to a
   subagent and keeps that subagent for later rounds.
3. A contact sheet sampled at the beats, and a **fresh reviewer** on it: one
   picture, a five-item checklist, a JSON verdict. The reviewer is new every
   round, on purpose. It sees the clip, never the argument for it.
4. On a pass, a full-quality record and render. Otherwise the fixes the
   verdict names, and another round.

The reviewer is `agents/versioncam-reviewer.md`, one file used three ways.
Claude Code registers it as an agent. A host that cannot register agents uses
it as a plain subagent's prompt. A host with no subagents at all applies it as
a checklist to the session's own sheet. The verdict records which, as
`"reviewer": "restricted"`, `"unrestricted"` or `"self"`. A clip passed by its
own author is a weaker claim, and says so.

Writing a clip never runs `git`. The clip lands in your clips directory as an
ordinary file, for you to read and commit yourself.

## version.cam

Once a repository publishes to version.cam, the same skill reads what is
there, and changes it, through the `versioncam cloud` commands
(`skills/versioncam/platform.md`):

```
/versioncam status            which clips are broken, since when, and what plays meanwhile
/versioncam fix [clip]        why one broke, a repair, and a pull request for it
/versioncam embed <clip>      the snippet for a README, a docs page or a landing page
```

It answers questions about the project as well: who can see its clips, who
is told when one breaks, and the plan. It changes a setting only when you
ask, and the change waits for you to approve it in your browser. A fix ends
in a pull request, which it opens only with your yes. The token the commands
sign in with stays in its file, and the skill never reads or prints it.
Paying, deleting a project and tokens for CI outside GitHub stay on
app.version.cam.

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

`.versioncam/` is a build product and is gitignored. Keep the clip. The
transcripts are for reading when something goes wrong, and for finding the
next thing to fix in the recorder. The paragraph on awkward tooling is there
because the first agent to write one produced a list that became a work
package.

## What it costs

On the example app, headless, with an earlier two-agent version of this loop,
one clip took between six and twelve minutes, in one or two rounds. All six
intents across two apps passed. Most of the time is model latency rather than
the recorder. A round is a handful of recordings of a few seconds each, and a
reviewer's single look at a single picture still takes a minute or two end to
end. It runs on a subscription rather than a metered key, so the setup cost
is close to zero. For anything higher-volume, the prompts in these files are
what would move to a direct SDK loop, unchanged.
