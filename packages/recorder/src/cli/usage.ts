/**
 * What `versioncam --help` prints, and the README's *Commands* section,
 * group for group and line for line.
 *
 * Its own module so a test can read it without running the CLI: the README
 * is also the website's documentation, and a test holds the two to the same
 * list. The DSL reference learned why, by promising an `s.drag` for months
 * that did not exist.
 *
 * Grouped by the stage of the work each command belongs to, in the order a
 * repository meets them. A flat list of seventeen commands left a newcomer to
 * work out that `inspect` comes before `record` and `sheet` after it. Manage
 * is what comes after publishing: `versioncam cloud`, whose own usage is that
 * group. The last group is not a stage but a way to run any of them.
 */
export const USAGE = `versioncam: record and render demo clips of a real app

Set up
  versioncam install                 the headless Chromium this version of versioncam records with
      --with-deps                    and its system libraries (Linux CI)
      --full                         also the full Chromium, which login and preview need for their window
  versioncam init                    install the authoring skill into .claude/
      --into <dir>                   into <dir>/versioncam/ instead, for an agent that reads skills from elsewhere
      --force                        overwrite files that are already there
  versioncam doctor                  check this machine can record, and that the app starts
  versioncam login                   sign in once and save the browser session

Write
  versioncam inspect <path>          what a clip can click, by accessible name, and where each name came from
      --json                         machine-readable
      --viewport <w>x<h>             at this size: 390x844 for a phone clip
  versioncam measure <path> <sel>    where a selector's matches are, and what they say
      --viewport <w>x<h>             at this size
  versioncam dsl                     the clip DSL: every method, its options and defaults

Record
  versioncam record [id…]            drive the app and capture frames
      --draft                        a quick recording at 15fps and CSS scale, for writing clips
      --replay <mode>                how to use recorded network answers, overriding the config: auto, record, replay or live
  versioncam check [id…]             record every clip; exit 1 if any breaks
      --report <file>                and write each clip's result there, as JSON
  versioncam stability [id…]         record each clip twice the same way, and say if they match
      --runs <n>                     how many times (default 2)
      --full                         at full quality rather than draft
      --replay <mode>                as for record

Review
  versioncam sheet <id>              an eight-frame contact sheet
      --at-marks                     one tile per beat instead of even spacing
  versioncam frame <id> <n>          one frame at output size, to a png
      --t <seconds>                  pick the frame by time instead
      --at <label>                   or by the beat it shows
  versioncam review <id>             the automatic checks, PASS or FAIL, with exit code 0 or 1
      --beats <file>                 the beats the clip should show, as [{ label, expect }]
      --min <s> --max <s>            duration bounds (default 9 and 11)
  versioncam preview <id>            open the scrubber in a real browser
      --scene <id>                   preview a scene instead
      --frame <n>                    start at this frame

Output
  versioncam render [id…]            composite and encode recordings and scenes
                                     with no ids, it renders all of them, stale recordings too
      --scene <id>                   also render this scene, even if no id names it (repeatable)
      --sequence                     stitch the results into one piece
      --report <file>                and write what it made there, as JSON

Publish
  versioncam publish [id…]           send the recordings and their checks to version.cam
      --dry-run                      print what would be sent, and send nothing
      --report <file>                and write the clips' permanent links there, as JSON
  versioncam ci                      write the GitHub Actions workflow that checks and publishes the clips
      --print                        print it instead, and write nothing
      --force                        replace the workflow file if there is one

Manage
  versioncam cloud login             sign in to version.cam, with a code you approve in a browser
      --label <name>                 what the approval page calls this machine
  versioncam cloud logout            sign out, which revokes the token and deletes it
  versioncam cloud status [project]  each clip, current or broken, and the version its link plays while broken
  versioncam cloud failure <clip>    print why a clip broke, and save its picture in .versioncam/failures/
  versioncam cloud ack <clip>        acknowledge a broken clip, which stops the reminders
  versioncam cloud embed <clip>      the snippets that embed a clip, and its files
  versioncam cloud set <name> <val>  change a setting, once you approve it in a browser:
                                     visibility public|unlisted|private, retention <days>|off,
                                     viewers on|off, alerts email|slack <address>|off,
                                     alerts issues on|off
  versioncam cloud plan [account]    the plan, and the links to upgrade and to billing
      --project <owner/repo>         which project, when not this repository's
      --json                         machine-readable, for status, failure, embed and plan

From another directory
  versioncam <command> --cwd <dir>   as if run in <dir>, which holds versioncam.config.ts
  versioncam --version               which versioncam this is

Run from a directory containing versioncam.config.ts, or name it with --cwd.
`;

/**
 * The flags each command reads.
 *
 * Every command parses leniently, so that a flag belonging to the top level can
 * pass through it. That also let a typo through in silence: `stability --fulll`
 * ran a draft and printed "stable". A test holds this table to the commands' own
 * option lists. `--draft` on `stability` and `--claude` on `init` are the
 * defaults spelt out, and `--json` on `measure` is for scripts; none is on the
 * usage page.
 */
export const FLAGS: Record<string, readonly string[]> = {
  check: ["report"],
  ci: ["print", "force"],
  cloud: ["json", "project", "label"],
  doctor: [],
  dsl: [],
  frame: ["t", "at"],
  init: ["force", "into", "claude"],
  inspect: ["json", "viewport"],
  install: ["with-deps", "full"],
  login: [],
  measure: ["json", "viewport"],
  preview: ["scene", "frame"],
  publish: ["dry-run", "report"],
  record: ["draft", "replay"],
  render: ["scene", "sequence", "report"],
  review: ["beats", "min", "max"],
  sheet: ["at-marks"],
  stability: ["runs", "draft", "full", "replay"],
};

/** The first flag on this line that the command does not read, if any. */
export function unknownFlag(command: string, argv: string[]): string | null {
  const known = FLAGS[command] ?? [];
  for (const arg of argv) {
    if (arg === "--") return null;
    if (!arg.startsWith("--")) continue;
    if (!known.includes(arg.slice(2).split("=")[0])) return arg;
  }
  return null;
}
