/**
 * A latch the clip opens when it is ready for something to arrive.
 *
 * Apps that stream a response — an assistant answering, a job reporting
 * progress — look wrong in a clip if the reply lands in the frame after the
 * request: it reads as a lookup rather than as work. The clip wants to hold on
 * the app's own pending state for a beat first.
 *
 * That beat has to be measured in *clip* time, not real time. A sleep inside
 * the route handler would resolve after however many frames the machine
 * happened to capture in that interval, which differs per machine and defeats
 * the whole design. So a mocked route waits on the gate, and the clip holds
 * for an authored duration — capturing the pending state while it does — and
 * then opens it.
 *
 *   const gate = createGate();
 *   await page.route(url, async (route) => {
 *     await gate.wait();
 *     await route.fulfill({ ... });
 *   });
 *   // in the clip:
 *   await s.press("Enter");
 *   await s.hold(1500);   // the app's spinner, on screen, for 1.5s of clip
 *   gate.open();
 */
export type Gate = {
  /** Resolves once the gate is open. Resolves immediately if it already is. */
  wait(): Promise<void>;
  /** Let whatever is waiting through. */
  open(): void;
  /** Close it again, for a clip with more than one turn. */
  close(): void;
  /** Whether something is currently waiting. */
  isHolding(): boolean;
};

export function createGate(startOpen = false): Gate {
  let open = startOpen;
  let waiting: (() => void)[] = [];

  return {
    wait() {
      if (open) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    },
    open() {
      open = true;
      const pending = waiting;
      waiting = [];
      for (const resolve of pending) resolve();
    },
    close() {
      open = false;
    },
    isHolding() {
      return waiting.length > 0;
    },
  };
}
