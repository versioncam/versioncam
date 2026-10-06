import { CloudError, transient, type CloudClient } from "./client.js";
import type {
  ChangePending,
  ChangeState,
  DeviceAuthorization,
  DeviceToken,
} from "./protocol.js";

/**
 * Waiting for a person: a sign-in or a change, approved in a browser while
 * the command asks, now and then, whether it has been.
 *
 * Time comes from a clock the caller hands over, so a test can wait ten
 * minutes in no time at all and see every interval the command chose.
 */

export type Clock = {
  /** Milliseconds, as `Date.now()`. */
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The longest a command waits: as long as a code lives, ten minutes. */
export const WAIT_LIMIT_MS = 10 * 60 * 1000;

/**
 * How long to wait for a code that lives `expiresIn` seconds: as long as it
 * does, never past ten minutes, and ten minutes when the answer did not say.
 */
export function waitLimit(expiresIn: number | undefined): number {
  return Math.min((expiresIn || 600) * 1000, WAIT_LIMIT_MS);
}

/** How often a change is asked after, which the service's answer does not say. */
export const CHANGE_INTERVAL_MS = 5000;

/** RFC 8628, 3.5: each `slow_down` adds five seconds, to this wait and every later one. */
const SLOW_DOWN_MS = 5000;

/** What one question answered: the end, ask again, or ask again more slowly. */
type Step<T> = { done: T } | "again" | "slower";

/**
 * Ask every `intervalMs` until an answer ends it, or until the next question
 * would come after `limitMs`; null then. The first question waits an
 * interval too: nobody has approved anything in the moment since the code
 * was printed.
 *
 * A question that got no answer, or was turned away for coming too often, or
 * met a failing service, is asked again at the next turn rather than ending
 * the wait: the person may be approving it at that moment, and a sign-in
 * given up on is a code they approve for nothing.
 */
async function poll<T>(
  ask: () => Promise<Step<T>>,
  intervalMs: number,
  limitMs: number,
  clock: Clock,
): Promise<T | null> {
  const deadline = clock.now() + limitMs;
  let interval = intervalMs;
  let wait = interval;
  while (clock.now() + wait <= deadline) {
    await clock.sleep(wait);
    wait = interval;
    let step: Step<T>;
    try {
      step = await ask();
    } catch (error) {
      if (!transient(error)) throw error;
      wait = Math.max(interval, (error.retryAfter ?? 0) * 1000);
      continue;
    }
    if (step === "again") continue;
    if (step === "slower") {
      interval += SLOW_DOWN_MS;
      wait = interval;
      continue;
    }
    return step.done;
  }
  return null;
}

export type SignIn =
  | { kind: "token"; token: DeviceToken }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "timeout" };

/**
 * Ask for the token at the service's interval, as RFC 8628 has a device do,
 * until it comes, the person denies it, or the code expires. Never longer
 * than the code lives, nor than ten minutes.
 */
export async function waitForToken(
  client: CloudClient,
  device: DeviceAuthorization,
  clock: Clock,
): Promise<SignIn> {
  // RFC 8628 has a device wait five seconds when the answer gave no interval.
  const interval = Math.max(1, device.interval || 5) * 1000;
  const outcome = await poll<SignIn>(
    async () => {
      try {
        return {
          done: {
            kind: "token",
            token: await client.token(device.device_code),
          },
        };
      } catch (error) {
        if (!(error instanceof CloudError)) throw error;
        if (error.code === "authorization_pending") return "again";
        if (error.code === "slow_down") return "slower";
        if (error.code === "access_denied") return { done: { kind: "denied" } };
        if (error.code === "expired_token") {
          return { done: { kind: "expired" } };
        }
        throw error;
      }
    },
    interval,
    waitLimit(device.expires_in),
    clock,
  );
  return outcome ?? { kind: "timeout" };
}

export type ChangeOutcome =
  Exclude<ChangeState["state"], "pending"> | "timeout";

/** Ask after a change every five seconds until it is applied, denied or expired. */
export async function waitForChange(
  client: CloudClient,
  project: string,
  pending: ChangePending,
  clock: Clock,
): Promise<ChangeOutcome> {
  const outcome = await poll<ChangeOutcome>(
    async () => {
      const { state } = await client.changeState(project, pending.change);
      return state === "pending" ? "again" : { done: state };
    },
    CHANGE_INTERVAL_MS,
    waitLimit(pending.expires_in),
    clock,
  );
  return outcome ?? "timeout";
}
