import { withApp } from "../app-server.js";
import type { ResolvedConfig } from "../config.js";

/**
 * `withApp`, for a command: the same, plus one line when it had to start the
 * app itself.
 *
 * On stderr, because stdout belongs to the command — `inspect --json` is
 * parsed, and the first line `sheet` prints is a path things read. And only
 * when something was started: that is worth knowing, since it is why the
 * command took a few seconds longer and why nothing is listening once it has
 * finished, while a server found already running is the normal case and not
 * worth a line in every call an authoring loop makes.
 */
export function drivingApp<T>(
  config: ResolvedConfig,
  fn: () => Promise<T>,
): Promise<T> {
  return withApp(config, async (app) => {
    if (app.started) {
      process.stderr.write(
        `app: ${app.detail}; it stops when this command does\n`,
      );
    }
    return fn();
  });
}
