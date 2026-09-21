import { describe, expect, it } from "vitest";
import { sseBody } from "./sse.js";

/**
 * A minimal SSE reader, written here rather than imported.
 *
 * The contract that matters is with a *consuming app's* parser, and that test
 * belongs beside the app. What this file can check is the format itself, and
 * checking it against a parser written from the spec is a real check;
 * checking it against a shared helper would only prove the two agree.
 */
function parse(body: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    if (block.trim() === "") continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
    out.push({ event, data: JSON.parse(data.join("\n")) });
  }
  return out;
}

describe("sseBody", () => {
  it("round-trips events and their payloads", () => {
    expect(
      parse(
        sseBody([
          { event: "open", data: { job_id: "j1" } },
          { event: "completed", data: { status: "COMPLETED", n: 2 } },
        ]),
      ),
    ).toEqual([
      { event: "open", data: { job_id: "j1" } },
      { event: "completed", data: { status: "COMPLETED", n: 2 } },
    ]);
  });

  it("survives content with newlines and unicode", () => {
    // JSON escapes the newline, so it cannot be mistaken for an event
    // boundary — the failure mode this guards against.
    const content = "Line one\n\nLine two — with an em dash and ⌥";
    const [event] = parse(sseBody([{ event: "completed", data: { content } }]));
    expect((event.data as { content: string }).content).toBe(content);
  });

  it("produces an empty body for no events", () => {
    expect(sseBody([])).toBe("");
  });
});
