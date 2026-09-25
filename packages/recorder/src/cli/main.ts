#!/usr/bin/env node
import { parseArgs } from "node:util";
import { check } from "./commands/check.js";
import { doctor } from "./commands/doctor.js";
import { dsl } from "./commands/dsl.js";
import { frame } from "./commands/frame.js";
import { init } from "./commands/init.js";
import { inspect } from "./commands/inspect.js";
import { install } from "./commands/install.js";
import { login } from "./commands/login.js";
import { measure } from "./commands/measure.js";
import { preview } from "./commands/preview.js";
import { record } from "./commands/record.js";
import { render } from "./commands/render.js";
import { review } from "./commands/review.js";
import { sheet } from "./commands/sheet.js";
import { stability } from "./commands/stability.js";
import { loadEnvFiles } from "../env.js";
import { USAGE } from "./usage.js";


type Command = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  record,
  render,
  check,
  stability,
  sheet,
  frame,
  preview,
  review,
  inspect,
  measure,
  dsl,
  login,
  doctor,
  install,
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
