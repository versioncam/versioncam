import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";
import { headersOf } from "./headers.js";

const BASE = "https://my-app-git-feature-team.vercel.app";

describe("the config's headers", () => {
  it("go to baseUrl's origin, the empty ones known by name and not sent", () => {
    const headers = headersOf(
      {
        "x-vercel-protection-bypass": "s3cret",
        "X-Vercel-Skip-Toolbar": "1",
        "CF-Access-Client-Id": "",
        "CF-Access-Client-Secret": undefined,
      },
      `${BASE}/app`,
    );
    expect(headers).toEqual({
      origin: BASE,
      send: {
        "x-vercel-protection-bypass": "s3cret",
        "X-Vercel-Skip-Toolbar": "1",
      },
      names: [
        "x-vercel-protection-bypass",
        "x-vercel-skip-toolbar",
        "cf-access-client-id",
        "cf-access-client-secret",
      ],
    });
  });

  it("are nothing at all when absent or empty", () => {
    expect(headersOf(undefined, BASE)).toBeNull();
    expect(headersOf({}, BASE)).toBeNull();
  });

  it("refuse what is not a header, and what the browser decides itself", () => {
    expect(() => headersOf({ "x bad": "1" }, BASE)).toThrow(
      "not a header name",
    );
    expect(() => headersOf({ Cookie: "a=1" }, BASE)).toThrow("storageState");
    expect(() => headersOf({ host: "x" }, BASE)).toThrow("can't be set");
    expect(() => headersOf({ "x-a": "1", "X-A": "2" }, BASE)).toThrow("twice");
    expect(() => headersOf(["x-a"], BASE)).toThrow("must be an object");
    expect(() => headersOf({ "x-a": 1 }, BASE)).toThrow("must be a string");
    expect(() => headersOf({ "x-a": "1" }, "localhost:3000")).toThrow(
      "http(s)",
    );
  });

  it("never print a value they refuse", () => {
    // A value is usually a secret, and an error goes to a CI log.
    expect(() => headersOf({ "x-a": 12345 }, BASE)).not.toThrow(/12345/);
  });

  it("join the replay's never-written list, and leave a config without them alone", () => {
    const root = "/tmp/versioncam-headers-test";
    const withHeaders = resolveConfig(
      {
        baseUrl: BASE,
        headers: { "X-Vercel-Protection-Bypass": process.env.NOT_SET_ANYWHERE },
        replay: { record: ["**/api/**"] },
      },
      root,
    );
    expect(withHeaders.replay?.headers).toEqual(["x-vercel-protection-bypass"]);
    const without = resolveConfig(
      { baseUrl: BASE, replay: { record: ["**/api/**"] } },
      root,
    );
    expect(without.headers).toBeNull();
    expect(without.replay?.headers).toEqual([]);
  });
});
