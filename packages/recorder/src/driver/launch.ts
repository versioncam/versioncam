import { chromium } from "playwright";
import type { Browser } from "playwright";

/**
 * How the recorder launches Chromium, everywhere.
 *
 * One flag, and it is here because of a measurement.
 *
 * `--disable-partial-raster` makes Chromium repaint the whole tile when part
 * of it changes, instead of only the rectangle the page reported as changed.
 * A full recording does not need it: every frame of the example app's clips
 * is byte-identical with and without it, on macOS and on Linux. A draft does.
 * Its CSS-scale screenshot of a page at device pixel ratio 2 has Chromium
 * paint the page a second time, at half the scale, for every shot, and when it
 * can, repaint only what changed since the last one — from rectangles measured
 * at the page's own scale. At half the scale a glyph's antialiased edge can
 * land a pixel outside its rectangle, and whether that pixel was repainted
 * then depends on which tiles Chromium happened to keep, which depends on
 * timing. On the Linux runner, where text has LCD antialiasing, the example
 * app's draft differed at frame 23 in 19 of 32 pairs of runs, by one pixel:
 * the red fringe at the right edge of the "r" just typed into "Mir", drawn or
 * still white. With this flag, 28 pairs of 28 matched on the same runner.
 *
 * The list was empty before that, and the emptiness was a finding too. Chasing
 * a six-pixel difference between two runs of one clip, the obvious suspect was
 * font rasterisation, so these three went in:
 *
 *     --disable-lcd-text  --disable-font-subpixel-positioning
 *     --force-color-profile=srgb
 *
 * They made no difference, because the cause was elsewhere: the screenshot was
 * being taken with Playwright's `animations: "disabled"`, which cancelled the
 * spinner to rotation zero and raced the recorder's own scrub. Once that was
 * fixed, six consecutive runs came out byte-identical with no flags at all.
 *
 * A flag that changes how a correct page looks would change every captured
 * pixel, so the bar for adding one is a measurement showing it fixes
 * something. Keeping this function as the single launch site is the point:
 * there is one place to put such a flag, and one place to explain it.
 */
export const DETERMINISTIC_ARGS: string[] = ["--disable-partial-raster"];

/** Launch Chromium the way every recorder command should. */
export function launchBrowser(
  options: { headless?: boolean } = {},
): Promise<Browser> {
  return chromium.launch({
    headless: options.headless ?? true,
    args: DETERMINISTIC_ARGS,
  });
}
