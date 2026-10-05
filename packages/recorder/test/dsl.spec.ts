import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DSL_FILE } from "../src/cli/commands/dsl.js";
import { launchBrowser } from "../src/driver/launch.js";
import { RecordingSession } from "../src/driver/session.js";
import { testConfig } from "./support.js";

/**
 * The reference and the class must name the same things.
 *
 * This test is the whole point of having a reference file at all. The README
 * promised `s.drag` for months — a method that has never existed — and prose
 * about an API drifts silently, in both directions: a method nobody documented
 * is a method nobody uses, and a method nobody wrote is an hour lost by
 * whoever believed the document.
 */

/**
 * Members that are deliberately not part of the authoring surface.
 *
 * TypeScript's `private` is erased, so every private method is on the
 * prototype at runtime and reflection alone cannot tell them from the public
 * ones. This list is that seam: a new method fails this test until it is
 * either written into `dsl.md` or named here, which is the point — the
 * classification should be a decision rather than an oversight.
 */
const NOT_AUTHORING_SURFACE = new Set([
  "constructor",
  // Called by `runClip` once a clip's body has returned, never by a clip.
  "finish",
  // Called by `runClip` to hand the script its view of the session.
  "forClipBody",
  // Called by `runClip` for the targets sidecar and the failing step.
  "evidence",
  // Private, and visible here only because `private` is a compile-time word.
  "defaultHook",
  "frameCamera",
  "pushHold",
  "boxOf",
  "untilVisible",
  "syncTransitions",
  "whileTicking",
  "whyLocatorFailed",
  "resolvePoint",
  "resolveSize",
  "advanceTo",
  "shouldCapture",
  "pressMouse",
  "moveMouse",
  "captureFrame",
]);

/** Every member `dsl.md` documents: its headings of the form ### `name(…)`. */
function documentedNames(): string[] {
  const reference = readFileSync(DSL_FILE, "utf8");
  return [...reference.matchAll(/^### `([A-Za-z.]+)[(`]/gm)].map((m) => m[1]);
}

test("dsl.md documents exactly the session's authoring surface", () => {
  const documented = documentedNames();
  expect(new Set(documented).size).toBe(documented.length);

  const onTheClass = Object.getOwnPropertyNames(
    RecordingSession.prototype,
  ).filter((name) => !NOT_AUTHORING_SURFACE.has(name));

  // Members of `s.camera` are documented as `camera.zoom` and checked against
  // a real session below; everything else is a method or getter on the class.
  const plain = documented.filter((name) => !name.includes("."));

  expect([...plain].sort()).toEqual([...onTheClass].sort());
});

test("the members documented under camera are the ones it has", async () => {
  // The camera is an object on the instance rather than a method on the
  // prototype, so reflection over the class cannot see it and it needs a real
  // session — which needs a real page.
  const browser = await launchBrowser();
  try {
    const config = testConfig();
    const page = await browser.newPage({ viewport: config.viewport });
    const session = new RecordingSession(page, {
      clipId: "dsl",
      title: "DSL",
      fps: config.fps,
      viewport: config.viewport,
      dpr: config.dpr,
      seed: 1,
      outputDir: join(config.recordingsDir, "dsl"),
      appCommit: "unknown",
      capture: config.capture,
      draft: false,
      config,
    });

    const documented = documentedNames()
      .filter((name) => name.startsWith("camera."))
      .map((name) => name.slice("camera.".length));
    expect([...documented].sort()).toEqual(Object.keys(session.camera).sort());

    // And the one public field the reference mentions in prose.
    expect(session.page).toBe(page);

    await page.close();
  } finally {
    await browser.close();
  }
});

test("every documented method is really callable", () => {
  const session = RecordingSession.prototype as unknown as Record<
    string,
    unknown
  >;
  for (const name of documentedNames()) {
    if (name.includes(".")) continue;
    const member = Object.getOwnPropertyDescriptor(
      RecordingSession.prototype,
      name,
    );
    // A getter is documented as a value and a method as a function; what must
    // never happen is a name here that resolves to nothing at all.
    expect(member, `dsl.md documents \`${name}\``).toBeDefined();
    expect(
      typeof (member?.get ?? session[name]),
      `\`${name}\` is callable or readable`,
    ).toBe("function");
  }
});
