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
 * work out that `inspect` comes before `record` and `sheet` after it. The
 * last group is not a stage but a way to run any of them.
 */
export const USAGE = `versioncam: record and render demo clips of a real app

Set up
  versioncam install                 the Chromium this version of versioncam records with
      --with-deps                    and its system libraries (Linux CI)
  versioncam init                    install the authoring skill into .claude/
      --into <dir>                   into <dir>/versioncam/ instead, for another host
      --force                        overwrite files that are already there
  versioncam doctor                  check this machine can record, and that the app starts
  versioncam login                   sign in once and save the browser session

Write
  versioncam inspect <path>          what a clip can click, and where each name came from
      --json                         machine-readable
  versioncam measure <path> <sel>    where a selector's matches are, and what they say
  versioncam dsl                     the clip DSL: every method, its options and defaults

Record
  versioncam record [id…]            drive the app and capture frames
      --draft                        15fps at CSS scale: cheap, for writing clips
  versioncam check [id…]             record every clip; exit 1 if any breaks
  versioncam stability [id…]         record each clip twice the same way; stable or not
      --runs <n>                     how many times (default 2)
      --full                         at full quality rather than draft

Review
  versioncam sheet <id>              an eight-frame contact sheet
      --at-marks                     sample the beats instead of even spacing
  versioncam frame <id> <n>          one frame at output size, to a png
      --t <seconds>                  pick the frame by time instead
      --at <label>                   or by the beat it shows
  versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
      --beats <file>                 [{ label, expect }] the clip promised
      --min <s> --max <s>            duration bounds (default 9 and 11)
  versioncam preview <id>            open the scrubber in a real browser
      --scene <id>                   preview a scene instead
      --frame <n>                    start at this frame

Output
  versioncam render [id…]            composite and encode what has been recorded
      --scene <id>                   render a designed scene (repeatable)
      --sequence                     stitch the results into one piece

From another directory
  versioncam <command> --cwd <dir>   as if run in <dir>, which holds versioncam.config.ts

Run from a directory containing versioncam.config.ts, or name it with --cwd.
`;
