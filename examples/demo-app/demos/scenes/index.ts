import type { Scene } from "versioncam/scene";

/**
 * A designed panel: frames drawn rather than captured.
 *
 * Here to demonstrate the hook and to say, in the clip set itself, what the
 * recorder does — an idea with no screen to point a camera at. The package
 * ships no scenes; artwork belongs to the app that wants it.
 */

const FPS = 60;
const DURATION = 6;

/** 0..1 over [from, to], eased so nothing starts or stops abruptly. */
function ramp(t: number, from: number, to: number): number {
  const u = Math.max(0, Math.min(1, (t - from) / Math.max(1e-6, to - from)));
  return u * u * u * (10 + u * (-15 + 6 * u));
}

const BEATS = [
  { at: 0.8, label: "A script declares the timeline" },
  { at: 2.0, label: "The app is stepped through it, one frame at a time" },
  { at: 3.2, label: "Waiting happens off camera" },
  { at: 4.4, label: "The same bytes, every run" },
];

export const whatAClipIs: Scene = {
  id: "what-a-clip-is",
  title: "What a clip is",
  durationFrames: DURATION * FPS,
  fps: FPS,

  draw(ctx, frame, canvas) {
    const t = frame / FPS;

    ctx.fillStyle = "#10131a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // A film strip of frames, filling in as the beats land.
    const cells = 24;
    const stripW = canvas.width * 0.8;
    const cellW = stripW / cells;
    const x0 = (canvas.width - stripW) / 2;
    const y0 = canvas.height * 0.3;
    const h = canvas.height * 0.12;

    for (let i = 0; i < cells; i += 1) {
      const appear = ramp(t, 0.5 + i * 0.05, 0.9 + i * 0.05);
      if (appear <= 0) continue;
      ctx.globalAlpha = appear;
      ctx.fillStyle = i % 4 === 0 ? "#2f6fed" : "rgba(255,255,255,0.14)";
      ctx.fillRect(x0 + i * cellW + 2, y0, cellW - 4, h);
    }
    ctx.globalAlpha = 1;

    ctx.font =
      '600 34px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textBaseline = "middle";

    for (const [i, beat] of BEATS.entries()) {
      const opacity =
        ramp(t, beat.at, beat.at + 0.4) *
        (i === BEATS.length - 1
          ? 1
          : 1 - ramp(t, beat.at + 1.0, beat.at + 1.3));
      if (opacity <= 0) continue;
      ctx.globalAlpha = opacity;
      ctx.fillText(beat.label, x0, canvas.height * 0.58);
    }
    ctx.globalAlpha = 1;

    ctx.font =
      '600 26px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.globalAlpha = ramp(t, 0.2, 0.7);
    ctx.fillText("What a clip is", x0, canvas.height * 0.16);
    ctx.globalAlpha = 1;
  },
};

export default { [whatAClipIs.id]: whatAClipIs } satisfies Record<
  string,
  Scene
>;
