import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/**
 * `versioncam stability`, run the way a first run of the skill runs it: as a
 * command, in the app's directory, with nothing started beforehand.
 *
 * This is the claim the rest of the example stands on. If this app does not
 * record the same way twice, every clip written against it inherits the
 * difference, and the gate test next door could not tell the gate's fault
 * from the app's.
 */
const APP = fileURLToPath(new URL("..", import.meta.url));

test("the example app records the same way twice", async () => {
  let stdout = "";
  let status = 0;
  try {
    ({ stdout } = await promisify(execFile)(
      "npx",
      ["versioncam", "stability", "01-create-a-shipment"],
      { cwd: APP, encoding: "utf8" },
    ));
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    status = e.code ?? 1;
    stdout = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }

  expect(stdout).toMatch(
    /01-create-a-shipment: run 1 vs run 2 — (\d+) frames, \1 identical/,
  );
  expect(stdout.trim().split("\n").at(-1)).toBe("stable");
  expect(status).toBe(0);
});
