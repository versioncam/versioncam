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
import { publish } from "./commands/publish.js";
import { record } from "./commands/record.js";
import { render } from "./commands/render.js";
import { review } from "./commands/review.js";
import { sheet } from "./commands/sheet.js";
import { stability } from "./commands/stability.js";
import { loadEnvFiles } from "../env.js";
import { enterCwd, takeCwd } from "./cwd.js";
import { USAGE } from "./usage.js";

type Command = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  record,
  render,
  publish,
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
  // `--cwd` comes out first: it takes a value, which the parsing below would
  // otherwise read as the command's name.
  const { cwd, rest: argv } = takeCwd(process.argv.slice(2));

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

  // Before the environment files, which are that directory's too.
  if (cwd !== undefined) enterCwd(cwd);
  loadEnvFiles(process.cwd());

  // The command's own arguments: everything but its name, wherever the name
  // was, which is first unless a flag came before it.
  const at = argv.indexOf(name);
  return command([...argv.slice(0, at), ...argv.slice(at + 1)]);
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
