import { describe, expect, it } from "vitest";
import { RECORDER_VERSION } from "../../driver/clip.js";
import type {
  PublishBeginResponse,
  PublishCommitResponse,
  PublishedVersion,
} from "../../publish/protocol.js";
import { publishedReport, versionLine } from "./publish.js";

const API = "https://api.version.cam";

const begun: PublishBeginResponse = {
  publishId: "pub_7k3m2x9q4r8t1v5w6y0a",
  project: "acme/shop",
  needStates: [],
  needTimelines: [],
  needTargets: [],
  needFailures: [],
  refused: [{ clip: "tour", reason: "It runs longer than the plan allows." }],
};

const broken: PublishedVersion = {
  clip: "add-a-book",
  version: "ver_9d1e5f7g3h2j4k6m8n0q",
  url: "https://clips.version.cam/acme/shop/add-a-book",
  versionUrl: "https://clips.version.cam/acme/shop/add-a-book@9c4e1b7a2d3f",
  check: "fail",
  unchanged: false,
  stale: true,
  refused: null,
};

describe("what a publish says of each version", () => {
  it("calls a clip that failed on the default branch broken", () => {
    expect(versionLine(broken)).toBe(
      "add-a-book: failed its check, broken at https://clips.version.cam/acme/shop/add-a-book@9c4e1b7a2d3f",
    );
    // On a pull request's branch the failure is that version's own.
    expect(versionLine({ ...broken, stale: false })).toBe(
      "add-a-book: failed its check, recorded at https://clips.version.cam/acme/shop/add-a-book@9c4e1b7a2d3f",
    );
    expect(
      versionLine({ ...broken, check: "pass", stale: false, unchanged: true }),
    ).toBe(
      "add-a-book: https://clips.version.cam/acme/shop/add-a-book (unchanged)",
    );
  });
});

describe("the publish report", () => {
  it("is what it always was for an answer that says no more", () => {
    expect(
      publishedReport(API, begun, { project: "acme/shop", versions: [broken] }),
    ).toEqual({
      recorder: RECORDER_VERSION,
      api: API,
      project: "acme/shop",
      versions: [broken],
      refused: begun.refused,
      error: null,
    });
  });

  it("passes on what the service adds to its answer, for the Action's summary", () => {
    // Fields this version of the protocol does not name: the report carries
    // them as they came, a version's own included.
    const playing = {
      version: "ver_6t8v0w2x4y6z8a0b2c4d",
      commit: "3f2a1c9e8d7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
      recordedAt: "2026-10-03T12:00:00.000Z",
    };
    const answer = {
      project: "acme/shop",
      manage: "https://app.version.cam/acme/shop",
      visibility: "private",
      alerts: false,
      versions: [{ ...broken, playing }],
    };
    expect(
      publishedReport(API, begun, answer as PublishCommitResponse),
    ).toEqual({
      ...answer,
      recorder: RECORDER_VERSION,
      api: API,
      refused: begun.refused,
      error: null,
    });
  });

  it("keeps what only this side knows, whatever the answer says", () => {
    const answer = {
      project: "acme/shop",
      versions: [],
      recorder: "9.9.9",
      api: "https://elsewhere.example",
      refused: [],
      error: "made up",
    };
    expect(
      publishedReport(API, begun, answer as PublishCommitResponse),
    ).toMatchObject({
      recorder: RECORDER_VERSION,
      api: API,
      refused: begun.refused,
      error: null,
    });
  });
});
