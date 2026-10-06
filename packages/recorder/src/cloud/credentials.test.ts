import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiOrigin,
  credentialsPath,
  readCredential,
  removeCredential,
  saveCredential,
  type Credential,
} from "./credentials.js";

const PRODUCTION = "https://api.version.cam";
const STAGING = "https://api-staging.version.cam";

/** Not a token: a string shaped like one, for the file to hold. */
const signedIn: Credential = {
  token: "vcu_fake_for_tests_only",
  login: "peter",
  expiresAt: "2026-10-13T12:00:00.000Z",
};

function home(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "versioncam-credentials-"));
  return { HOME: dir, XDG_CONFIG_HOME: join(dir, "config") };
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe("the credentials file", () => {
  it("lives under XDG_CONFIG_HOME, else ~/.config", () => {
    expect(
      credentialsPath({ HOME: "/home/peter", XDG_CONFIG_HOME: "/xdg" }),
    ).toBe("/xdg/versioncam/credentials.json");
    expect(credentialsPath({ HOME: "/home/peter" })).toBe(
      "/home/peter/.config/versioncam/credentials.json",
    );
    // Relative, it would put the token wherever the command ran.
    expect(
      credentialsPath({ HOME: "/home/peter", XDG_CONFIG_HOME: "config" }),
    ).toBe("/home/peter/.config/versioncam/credentials.json");
  });

  it("is the owner's alone: the directory 0700, the file 0600", () => {
    const env = home();
    const path = saveCredential(env, PRODUCTION, signedIn);
    expect(path).toBe(credentialsPath(env));
    expect(mode(dirname(path))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    // Nothing left beside it from the write.
    expect(readdirSync(dirname(path))).toEqual(["credentials.json"]);
  });

  it("tightens a directory and a file that were looser", () => {
    const env = home();
    const path = credentialsPath(env);
    mkdirSync(dirname(path), { recursive: true });
    chmodSync(dirname(path), 0o755);
    writeFileSync(path, "{}");
    chmodSync(path, 0o644);
    saveCredential(env, PRODUCTION, signedIn);
    expect(mode(dirname(path))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
  });

  it("keeps each API's sign-in under its origin, side by side", () => {
    const env = home();
    saveCredential(env, `${PRODUCTION}/`, signedIn);
    saveCredential(env, STAGING, { ...signedIn, login: "peter-staging" });
    expect(
      JSON.parse(readFileSync(credentialsPath(env), "utf8")),
    ).toStrictEqual({
      [PRODUCTION]: signedIn,
      [STAGING]: { ...signedIn, login: "peter-staging" },
    });
    expect(readCredential(env, PRODUCTION)).toStrictEqual(signedIn);
    expect(readCredential(env, `${STAGING}/v1`)?.login).toBe("peter-staging");
    expect(readCredential(env, "http://localhost:8787")).toBeNull();
    expect(apiOrigin("https://api.version.cam/")).toBe(PRODUCTION);
  });

  it("forgets one sign-in without the other, and goes with the last", () => {
    const env = home();
    saveCredential(env, PRODUCTION, signedIn);
    saveCredential(env, STAGING, signedIn);
    expect(removeCredential(env, STAGING)).toBe(true);
    expect(readCredential(env, STAGING)).toBeNull();
    expect(readCredential(env, PRODUCTION)).toStrictEqual(signedIn);
    expect(removeCredential(env, STAGING)).toBe(false);
    expect(removeCredential(env, PRODUCTION)).toBe(true);
    expect(existsSync(credentialsPath(env))).toBe(false);
  });

  it("reads a file it cannot use as no sign-in, and writes a good one over it", () => {
    const env = home();
    const path = credentialsPath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json");
    expect(readCredential(env, PRODUCTION)).toBeNull();
    saveCredential(env, PRODUCTION, signedIn);
    expect(readCredential(env, PRODUCTION)).toStrictEqual(signedIn);

    // Keys that are not origins, and entries that are not sign-ins, are
    // nobody's: not kept, and never a property of anything.
    writeFileSync(
      path,
      JSON.stringify({
        ["__proto__"]: signedIn,
        "not an origin": signedIn,
        [STAGING]: { token: 7 },
        [PRODUCTION]: signedIn,
      }),
    );
    saveCredential(env, "http://localhost:8787", signedIn);
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")))).toEqual([
      PRODUCTION,
      "http://localhost:8787",
    ]);
  });
});
