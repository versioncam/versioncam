import type { Scene } from "../scene.js";

/**
 * What a scenes module has to export, checked the same way wherever one is
 * read: in Node, where the CLI lists the ids to render and filter, and in the
 * render page, which draws them.
 *
 * Both used to take `module.default` and carry on with whatever it was. A
 * module whose record of scenes was a named export gave them nothing at all:
 * `render` found no scenes, said nothing, and stitched a film without them.
 * Anything that is not a record of scenes now stops the command, naming the
 * file and the shape it should have.
 *
 * A record with nothing in it is still a record, and renders no scenes, which
 * is what it says.
 */

/** The shape, as the second line of every refusal. */
const SHAPE =
  "versioncam reads scenes from a module's default export: a Record<string, Scene> " +
  "keyed by scene id, as in `export default { [intro.id]: intro }`.";

/** For anything but a plain object, which is never what is being described. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** A value as it was written, so `"60"` does not read as the number 60. */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** What is wrong with one entry, or null when it can be drawn. */
function entryProblem(key: string, value: unknown): string | null {
  if (!isPlainObject(value))
    return `"${key}" is ${describe(value)}, not a scene`;
  const { draw, durationFrames, fps } = value as Partial<Scene>;
  if (typeof draw !== "function") {
    return `"${key}" has no draw(ctx, frame, canvas)`;
  }
  if (!Number.isInteger(durationFrames) || (durationFrames as number) < 1) {
    return `"${key}" has durationFrames ${shown(durationFrames)}, where a whole number of frames, 1 or more, belongs`;
  }
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    return `"${key}" has fps ${shown(fps)}, where a number above 0 belongs`;
  }
  return null;
}

/**
 * What is wrong with a would-be record of scenes, as the end of a sentence
 * that starts "default-exports", or null when nothing is.
 *
 * A single scene and an array are singled out because they are the two
 * mistakes a clip file invites: a clip file default-exports one clip or an
 * array of them, and a scenes module does neither.
 */
function recordProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return describe(value);
  if (typeof value.draw === "function") {
    return "a single scene rather than a record of them";
  }
  for (const [key, entry] of Object.entries(value)) {
    const problem = entryProblem(key, entry);
    if (problem) return `a record in which ${problem}`;
  }
  return null;
}

/**
 * The scenes a module defines, by id, or why there are none to read.
 *
 * `file` names the module in the message: its path, wherever the path is
 * known. The message is three lines at most (what is wrong, the shape, and
 * the one-line fix when there is an obvious one), so `doctor` can print the
 * first as its finding and the rest beneath it.
 */
export function readScenes(
  module: Record<string, unknown>,
  file: string,
): { scenes: Record<string, Scene> } | { error: string } {
  if (module.default === undefined) {
    const named = Object.keys(module).filter((name) => name !== "default");
    const lines = [
      `${file} has no default export.` +
        (named.length > 0 ? ` It exports ${named.join(", ")}.` : ""),
      SHAPE,
    ];
    // The failure that made this check: the record was there, under a name.
    const records = named.filter(
      (name) =>
        recordProblem(module[name]) === null &&
        Object.keys(module[name] as object).length > 0,
    );
    if (records.length === 1) {
      lines.push(`${records[0]} is one: add \`export default ${records[0]}\`.`);
    }
    return { error: lines.join("\n") };
  }

  const problem = recordProblem(module.default);
  if (problem) {
    return { error: `${file} default-exports ${problem}.\n${SHAPE}` };
  }
  return { scenes: module.default as Record<string, Scene> };
}

/** What to say when scenes are asked for that the module does not define. */
export function missingScenes(
  asked: string[],
  defined: string[],
  file: string | null,
): string {
  const names = asked.map((id) => `"${id}"`).join(", ");
  const head = `No scene${asked.length === 1 ? "" : "s"} called ${names}.`;
  if (file === null) return `${head} The config names no \`scenes\` module.`;
  return `${head} ${file} defines ${defined.length > 0 ? defined.join(", ") : "none"}.`;
}
