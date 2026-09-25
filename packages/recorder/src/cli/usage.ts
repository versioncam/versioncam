/**
 * What `versioncam --help` prints, and the README's *Commands* block,
 * line for line.
 *
 * Its own module so a test can read it without running the CLI: the README
 * is also the website's documentation, and a test holds the two to the same
 * list — the DSL reference learned why, promising an `s.drag` for months that
 * did not exist.
 */
export const USAGE = `versioncam — record and render demo clips of a real app

  versioncam record [id…]            drive the app and capture frames
      --draft                        15fps at CSS scale: cheap, for writing clips
  versioncam render [id…]            composite and encode what has been recorded
      --scene <id>                   render a designed scene (repeatable)
      --sequence                     stitch the results into one piece
  versioncam check [id…]             record everything; non-zero if any clip breaks
  versioncam stability [id…]         record each clip twice the same way; stable or not
      --runs <n>                     how many times (default 2)
      --full                         at full quality rather than draft
  versioncam sheet <id>              an eight-frame contact sheet
      --at-marks                     sample the beats instead of even spacing
  versioncam frame <id> <n>          one frame at output size, to a png
      --t <seconds>                  pick the frame by time instead
      --at <label>                   or by the beat it shows
  versioncam preview <id>            open the scrubber in a real browser
      --scene <id>                   preview a scene instead
      --frame <n>                    start at this frame
  versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
      --beats <file>                 [{ label, expect }] the clip promised
      --min <s> --max <s>            duration bounds (default 9–11)
  versioncam inspect <path>          what a clip can click, and where each name came from
      --json                         machine-readable
  versioncam measure <path> <sel>    where the matches of a selector are, and what they say
  versioncam dsl                     the clip DSL, every method, one line each
  versioncam login                   sign in once and save the browser session
  versioncam doctor                  check this machine can record, and that the app starts
  versioncam install                 the Chromium this version of versioncam records with
      --with-deps                    and its system libraries (Linux CI)
  versioncam init                    install the authoring skill into .claude/
      --into <dir>                   into <dir>/versioncam/ instead, for another host
      --force                        overwrite files that are already there

Run from a directory containing versioncam.config.ts.
`;
