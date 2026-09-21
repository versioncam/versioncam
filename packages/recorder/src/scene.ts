/**
 * A designed panel: frames that are drawn rather than captured.
 *
 * Some things an app does have no screen to point a camera at — work that
 * happens before the UI exists, or a claim about where data goes. Mocking up a
 * screen for those is a worse lie than an honest diagram, so the renderer
 * accepts a composition that draws instead.
 *
 * A scene is a pure function of its frame number, exactly like a recording, so
 * both go through the same renderer, the same scrubber and the same encoder.
 * The package ships no scenes; the artwork belongs to the app.
 */
export type Scene = {
  id: string;
  title: string;
  durationFrames: number;
  fps: number;
  draw(ctx: CanvasRenderingContext2D, frame: number, canvas: Size): void;
};

export type Size = { width: number; height: number };
