#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { inspect } from "./commands/inspect.js";
import { login } from "./commands/login.js";
import { measure } from "./commands/measure.js";
import { preview } from "./commands/preview.js";
import { record } from "./commands/record.js";
import { render } from "./commands/render.js";
import { sheet } from "./commands/sheet.js";

const USAGE = `demos — record and render demo clips of a real app

  demos record [id…]            drive the app and capture frames
      --draft                     15fps at CSS scale: cheap, for writing clips
  demos render [id…]            composite and encode what has been recorded
      --scene <id>                render a designed scene (repeatable)
      --sequence                  stitch the results into one piece
  demos check [id…]             record everything; non-zero if any clip breaks
  demos sheet <id>              an eight-frame contact sheet
  demos preview <id>            open the scrubber in a real browser
      --scene <id>                preview a scene instead
      --frame <n>                 start at this frame
  demos inspect <path>          what is on a page, and what a clip can click
      --json                      machine-readable
  demos measure <path> <sel>    where the matches of a selector are
  demos login                   sign in once and save the browser session
  demos doctor                  check this machine can record and encode
  demos init --claude           copy the authoring skill and agents into .claude/
      --force                     overwrite files that are already there

Run from a directory containing recorder.config.ts.
`;

type Command = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  record,
  render,
  check,
  sheet,
  preview,
  inspect,
  measure,
  login,
  doctor,
  init,
};

/**
 * Load `.env.recording`, then `.env`, before anything reads the environment.
 *
 * Two files because the credentials a recording uses are usually not the ones
 * the app's own `.env` carries, and keeping them apart means the recording
 * file can hold a session token without that leaking into how the app runs.
 */
function loadEnvFiles(cwd: string): void {
  for (const name of [".env.recording", ".env"]) {
    const file = resolve(cwd, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

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
