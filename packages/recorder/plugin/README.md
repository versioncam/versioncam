# The versioncam skill

`/versioncam "<what the clip should show>"` records a clip of your web app. It
writes the script, records it, has a reviewer look at the result, and fixes
what the reviewer finds. It stops when the reviewer passes the clip or the
rounds run out. The first time it runs in a repository, it sets the
repository up first.

Nothing here calls a model's API. The model is whichever agent session runs
the skill. To look at a contact sheet, that session opens the image with the
same tool it uses to read files. Everything is markdown, and you can edit all of it.

## Install

The skill ships inside the `versioncam` npm package:

```bash
npx versioncam init        # .claude/skills/versioncam/ and .claude/agents/versioncam-reviewer.md
```

`init` installs the skill and nothing else, not even a config. The first run
writes the config. `init` refuses to overwrite a file that is already there,
and if any one file is there, it refuses the whole install. `--force`
overwrites. For an agent
host that reads skills from somewhere other than `.claude/`, `--into <dir>`
puts the skill directory at `<dir>/versioncam/`, with the reviewer inside it.

Or, without copying anything, load the plugin directory as it is:

```bash
claude --plugin-dir node_modules/versioncam/plugin
```

Or install it as a plugin from the repository's own marketplace, in a Claude
Code session (2.1.275 or later):

```
/plugin install versioncam --marketplace versioncam/versioncam
```

If you load it either of these two ways, the skill carries the plugin's name
as a prefix: `/versioncam:versioncam "<intent>"`. If `init` installed it, it
is `/versioncam`, as the examples below write it.

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

It commits nothing.

**In a monorepo** the skill first looks for `versioncam.config.ts` across the
whole repository, wherever the session started, and then works in the
directory that holds it. With several apps, it asks which. With none, the
first run writes the config where `versioncam init` put the skill.

**Every run** then goes like this (`skills/versioncam/SKILL.md`):

1. `versioncam doctor`, which starts the app, and `inspect /`.
2. The session writes the clip itself, following
   `skills/versioncam/authoring.md`. It reads `versioncam dsl` and the
   existing clips, writes a beat sheet, writes the clip, records it in draft,
   and runs the checks in `versioncam review`. It makes three recordings at
   most, then moves on. On a page too big to hold in context, it hands this step to a
   subagent and keeps that subagent for later rounds.
3. It makes a contact sheet sampled at the beats and gives it to a **fresh
   reviewer**. The reviewer gets that one picture and a five-item checklist,
   and answers with a JSON verdict. The reviewer is new every round, on
   purpose. It sees the clip, never the argument for it.
4. If the reviewer passes the clip, it records and renders at full quality.
   Otherwise it makes the fixes the verdict names and runs another round.

The reviewer is `agents/versioncam-reviewer.md`, one file used three ways.
Claude Code registers it as an agent. A host that cannot register agents uses
it as a plain subagent's prompt. A host with no subagents at all applies it as
a checklist to the session's own sheet. The verdict records which, as
`"reviewer": "restricted"`, `"unrestricted"` or `"self"`. A clip that its own
author passed is a weaker claim, and the verdict says so.

Writing a clip never runs `git`. The clip lands in your clips directory as an
ordinary file, for you to read and commit yourself.

## version.cam

Once a repository publishes to version.cam, the same skill reads and changes
what is there through the `versioncam cloud` commands
(`skills/versioncam/platform.md`):

```
/versioncam status            which clips are broken, since when, and what plays meanwhile
/versioncam fix [clip]        why one broke, a repair, and a pull request for it
/versioncam embed <clip>      the snippet for a README, a docs page or a landing page
```

It answers questions about the project as well: who can see its clips, who
gets an alert when one breaks, and the plan. It changes a setting only when you
ask, and the change waits for you to approve it in your browser. A fix ends
in a pull request, which it opens only with your yes. The token the commands
sign in with stays in its file, and the skill never reads or prints it.
You still do three things yourself on app.version.cam: pay, delete a
project, and make a project token for CI outside GitHub.

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

`.versioncam/` is a build product and is gitignored. The clip is the file you
keep and commit. The
transcripts are for reading when something goes wrong, and for finding the
next thing to fix in the recorder. The paragraph on awkward tooling is there
because the first agent to write a clip listed what was awkward, and that list
became our next set of fixes to the recorder.

## What it costs

On the example app, headless, with an earlier two-agent version of this loop,
one clip took between six and twelve minutes, in one or two rounds. All six
intents across two apps passed. Most of the time is model latency rather than
the recorder. A round is a handful of recordings of a few seconds each, and a
reviewer's single look at a single picture still takes a minute or two end to
end. It runs on a subscription rather than a metered key, so the setup cost
is close to zero. For higher volume, the prompts in these files would move
unchanged to a direct SDK loop.
