import type { Scene } from "../../src/scene.js";

/**
 * A scene that exists only to prove the path works: the app's own module,
 * bundled for the browser, imported by the render page over a route, drawing
 * into the same canvas a recording would.
 *
 * Deliberately trivial to look at. What is being tested is the plumbing.
 */
const ramp: Scene = {
  id: "ramp",
  title: "Colour ramp",
  durationFrames: 60,
  fps: 60,
  draw(ctx, frame, canvas) {
    ctx.fillStyle = `hsl(${frame * 6}, 60%, 50%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  },
};

export default { [ramp.id]: ramp } satisfies Record<string, Scene>;
