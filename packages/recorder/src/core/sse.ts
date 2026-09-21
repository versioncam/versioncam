/**
 * Server-sent-event bodies, for replaying a streamed response.
 *
 * An app that streams — an assistant answering, a job reporting progress —
 * cannot be part of a regenerable recording while it is live: the response
 * would differ every run. The driver intercepts the route and replays a
 * fixture instead. This builds the body; the shape of each event's payload
 * belongs to the app, so it stays in the app's own clip support code, along
 * with a contract test feeding this output back through the app's parser.
 */

export type SseFixtureEvent = { event: string; data: unknown };

export function sseBody(events: readonly SseFixtureEvent[]): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
}
