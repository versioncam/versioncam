import { describe, expect, it } from "vitest";
import { CloudError, type CloudClient } from "./client.js";
import type {
  ChangePending,
  ChangeState,
  DeviceAuthorization,
} from "./protocol.js";
import {
  waitForChange,
  waitForToken,
  WAIT_LIMIT_MS,
  type Clock,
} from "./wait.js";

/** A clock that moves only when it is slept on, and remembers every sleep. */
function fakeClock(): Clock & { sleeps: number[] } {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

const device: DeviceAuthorization = {
  device_code: "dc_test",
  user_code: "ABCD-EFGH",
  verification_uri: "https://app.version.cam/device",
  verification_uri_complete: "https://app.version.cam/device?code=ABCD-EFGH",
  expires_in: 600,
  interval: 5,
};

const granted = {
  token: "vcu_fake_for_tests_only",
  login: "peter",
  expires_at: "2026-10-13T12:00:00.000Z",
};

/** The token route, answering in turn: a code for a 400, a status for anything else. */
function tokenRoute(answers: (string | number | "token")[]) {
  let asked = 0;
  const client = {
    token: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
      if (answer === "token") return granted;
      if (typeof answer === "number") {
        throw new CloudError("busy", answer, "http", {
          retryAfter: answer === 429 ? 30 : null,
        });
      }
      throw new CloudError(answer, 400, answer);
    },
  } as unknown as CloudClient;
  return { client, asked: () => asked };
}

describe("waiting for a sign-in", () => {
  it("asks at the service's interval, and five seconds slower for good after each slow_down", async () => {
    const clock = fakeClock();
    const { client } = tokenRoute([
      "authorization_pending",
      "slow_down",
      "authorization_pending",
      "slow_down",
      "token",
    ]);
    const outcome = await waitForToken(client, device, clock);
    expect(outcome).toEqual({ kind: "token", token: granted });
    expect(clock.sleeps).toEqual([5000, 5000, 10000, 10000, 15000]);
  });

  it("asks again after no answer, a failing service, or too many questions", async () => {
    const clock = fakeClock();
    const { client } = tokenRoute([0, 503, 429, "token"]);
    const outcome = await waitForToken(client, device, clock);
    expect(outcome.kind).toBe("token");
    // A 429 waits as long as it says, and the interval after it is the same.
    expect(clock.sleeps).toEqual([5000, 5000, 5000, 30000]);
  });

  it("ends when the person denies it, or the code expires", async () => {
    expect(
      await waitForToken(
        tokenRoute(["access_denied"]).client,
        device,
        fakeClock(),
      ),
    ).toEqual({ kind: "denied" });
    expect(
      await waitForToken(
        tokenRoute(["authorization_pending", "expired_token"]).client,
        device,
        fakeClock(),
      ),
    ).toEqual({ kind: "expired" });
  });

  it("stops at a refusal no wait will change", async () => {
    const attempt = waitForToken(
      tokenRoute(["invalid_request"]).client,
      device,
      fakeClock(),
    );
    await expect(attempt).rejects.toThrow("invalid_request");
  });

  it("gives up after ten minutes, its last question at the last moment", async () => {
    const clock = fakeClock();
    const route = tokenRoute(["authorization_pending"]);
    // A code that claims to live an hour is still waited on for ten minutes.
    const outcome = await waitForToken(
      route.client,
      { ...device, expires_in: 3600 },
      clock,
    );
    expect(outcome).toEqual({ kind: "timeout" });
    expect(clock.now()).toBe(WAIT_LIMIT_MS);
    expect(route.asked()).toBe(WAIT_LIMIT_MS / 5000);
  });

  it("waits no longer than the code lives", async () => {
    const clock = fakeClock();
    const outcome = await waitForToken(
      tokenRoute(["authorization_pending"]).client,
      { ...device, expires_in: 60, interval: 0 },
      clock,
    );
    expect(outcome).toEqual({ kind: "timeout" });
    // No interval in the answer is RFC 8628's five seconds.
    expect(new Set(clock.sleeps)).toEqual(new Set([5000]));
    expect(clock.now()).toBe(60_000);
  });
});

describe("waiting for a change", () => {
  const pending: ChangePending = {
    change: "chg_test",
    user_code: "WXYZ-2345",
    verification_uri: "https://app.version.cam/device",
    verification_uri_complete: "https://app.version.cam/device?code=WXYZ-2345",
    expires_in: 600,
    describe: "Make acme/app's clips public.",
  };

  function changeRoute(states: ChangeState["state"][]) {
    let asked = 0;
    const seen: string[] = [];
    const client = {
      changeState: async (project: string, change: string) => {
        seen.push(`${project} ${change}`);
        const state = states[Math.min(asked, states.length - 1)];
        asked += 1;
        return { state };
      },
    } as unknown as CloudClient;
    return { client, seen };
  }

  it("asks every five seconds until it is applied, denied or expired", async () => {
    for (const end of ["applied", "denied", "expired"] as const) {
      const clock = fakeClock();
      const route = changeRoute(["pending", "pending", end]);
      expect(
        await waitForChange(route.client, "acme/app", pending, clock),
      ).toBe(end);
      expect(clock.sleeps).toEqual([5000, 5000, 5000]);
      expect(route.seen).toEqual(Array(3).fill("acme/app chg_test"));
    }
  });

  it("gives up after ten minutes", async () => {
    const clock = fakeClock();
    const route = changeRoute(["pending"]);
    expect(await waitForChange(route.client, "acme/app", pending, clock)).toBe(
      "timeout",
    );
    expect(clock.now()).toBe(WAIT_LIMIT_MS);
  });
});
