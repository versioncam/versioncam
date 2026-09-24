#!/usr/bin/env node
import { parseArgs } from "node:util";
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { dsl } from "./commands/dsl.js";
import { frame } from "./commands/frame.js";
import { init } from "./commands/init.js";
import { inspect } from "./commands/inspect.js";
import { login } from "./commands/login.js";
import { measure } from "./commands/measure.js";
import { preview } from "./commands/preview.js";
import { record } from "./commands/record.js";
import { render } from "./commands/render.js";
import { review } from "./commands/review.js";
import { sheet } from "./commands/sheet.js";
import { loadEnvFiles } from "../env.js";

const USAGE = `versioncam — record and render demo clips of a real app

  versioncam record [id…]            drive the app and capture frames
      --draft                        15fps at CSS scale: cheap, for writing clips
  versioncam render [id…]            composite and encode what has been recorded
      --scene <id>                   render a designed scene (repeatable)
      --sequence                     stitch the results into one piece
  versioncam check [id…]             record everything; non-zero if any clip breaks
  versioncam sheet <id>              an eight-frame contact sheet
      --at-marks                     sample the beats instead of even spacing
  versioncam frame <id> <n>          one frame at output size, to a png
      --t <seconds>                  pick the frame by time instead
  versioncam preview <id>            open the scrubber in a real browser
      --scene <id>                   preview a scene instead
      --frame <n>                    start at this frame
  versioncam review <id>             the checks that need no eyes; PASS/FAIL, exit 0/1
      --beats <file>                 [{ label, expect }] the clip promised
      --min <s> --max <s>            duration bounds (default 9–11)
  versioncam inspect <path>          what is on a page, and what a clip can click
      --json                         machine-readable
  versioncam measure <path> <sel>    where the matches of a selector are
  versioncam dsl                     the clip DSL, every method, one line each
  versioncam login                   sign in once and save the browser session
  versioncam doctor                  check this machine can record, and that the app starts
  versioncam init --claude           copy the authoring skill and agents into .claude/
      --force                        overwrite files that are already there

Run from a directory containing versioncam.config.ts.
`;

type Command = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  record,
  render,
  check,
  sheet,
  frame,
  preview,
  review,
  inspect,
  measure,
  dsl,
  login,
  doctor,
  init,
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // `--help` is a flag, not a positional, so it never reaches `positionals`.
  // Asking for help is a success; being given nothing is not.
  if (argv.some((a) => a === "--help" || a === "-h" || a === "help")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const { positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
  });

  const name = positionals[0];
  if (!name) {
    process.stdout.write(USAGE);
    return 1;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`Unknown command "${name}".\n\n${USAGE}`);
    return 1;
  }

  loadEnvFiles(process.cwd());
  return command(process.argv.slice(3));
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    process.stderr.write(`\n${error.message}\n`);
    process.exitCode = 1;
  },
);
