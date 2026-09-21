import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Where `dsl.md` sits relative to this module.
 *
 * Three levels up from `cli/commands/` reaches the package root from both
 * `src` and `dist`, which are the same depth — so the built CLI and a test
 * importing the source find the same file.
 */
export const DSL_FILE = fileURLToPath(
  new URL("../../../dsl.md", import.meta.url),
);

/**
 * Print the DSL reference.
 *
 * It exists as a command because the thing that needs it most has no way to
 * browse a repository: an agent writing a clip asks the tool what the tool can
 * do. A test holds the file and the class to the same list.
 */
export async function dsl(): Promise<number> {
  process.stdout.write(readFileSync(DSL_FILE, "utf8"));
  return 0;
}
