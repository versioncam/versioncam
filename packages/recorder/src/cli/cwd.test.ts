import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { takeCwd, versioncamFrom } from "./cwd.js";

describe("--cwd", () => {
  it("comes out of the arguments wherever it is", () => {
    expect(takeCwd(["--cwd", "apps/web", "doctor"])).toEqual({
      cwd: "apps/web",
      rest: ["doctor"],
    });
    // After the command's name, which is where an agent allowed only
    // `npx versioncam frame *` has to put it.
    expect(takeCwd(["frame", "01-open", "12", "--cwd", "apps/web"])).toEqual({
      cwd: "apps/web",
      rest: ["frame", "01-open", "12"],
    });
    expect(takeCwd(["record", "--cwd=apps/web", "--draft"])).toEqual({
      cwd: "apps/web",
      rest: ["record", "--draft"],
    });
    expect(takeCwd(["record", "--draft"])).toEqual({
      cwd: undefined,
      rest: ["record", "--draft"],
    });
  });

  it("needs a directory, and a flag is not one", () => {
    expect(() => takeCwd(["doctor", "--cwd"])).toThrow("needs a directory");
    expect(() => takeCwd(["doctor", "--cwd="])).toThrow("needs a directory");
    expect(() => takeCwd(["--cwd", "--draft", "record"])).toThrow(
      "needs a directory",
    );
  });
});

describe("versioncamFrom", () => {
  /** A package directory that says it is versioncam. */
  function fakeVersioncam(dir: string): string {
    const pkg = join(dir, "node_modules", "versioncam");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{ "name": "versioncam" }\n');
    return realpathSync(pkg);
  }

  it("finds the versioncam Node would, the nearest from the directory up", () => {
    const root = mkdtempSync(join(tmpdir(), "versioncam-from-"));
    const app = join(root, "apps", "web");
    mkdirSync(app, { recursive: true });

    // Hoisted to the root, as a workspace does it.
    const hoisted = fakeVersioncam(root);
    expect(versioncamFrom(app)).toBe(hoisted);

    // The app's own wins over the root's.
    const own = fakeVersioncam(app);
    expect(versioncamFrom(app)).toBe(own);
    expect(versioncamFrom(root)).toBe(hoisted);
  });

  it("follows a link to where the package really is", () => {
    // `npm link` and pnpm both install a symlink; the running CLI's own path
    // is already resolved, so the two only compare equal resolved.
    const root = mkdtempSync(join(tmpdir(), "versioncam-from-"));
    const real = fakeVersioncam(join(root, "checkout"));
    const app = join(root, "app");
    mkdirSync(join(app, "node_modules"), { recursive: true });
    symlinkSync(real, join(app, "node_modules", "versioncam"), "dir");
    expect(versioncamFrom(app)).toBe(real);
  });

  it("is null where there is none", () => {
    expect(
      versioncamFrom(mkdtempSync(join(tmpdir(), "versioncam-from-"))),
    ).toBeNull();
  });
});
