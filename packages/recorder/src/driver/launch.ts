import { chromium } from "playwright";
import type { Browser } from "playwright";

/**
 * How the recorder launches Chromium, everywhere.
 *
 * The list is empty, and that is a finding rather than an oversight. Chasing a
 * six-pixel difference between two runs of one clip, the obvious suspect was
 * font rasterisation — text beside an animating element can be antialiased one
 * way in a composited layer and another way outside it. So these three went in:
 *
 *     --disable-lcd-text  --disable-font-subpixel-positioning
 *     --force-color-profile=srgb
 *
 * They made no difference, because the cause was elsewhere: the screenshot was
 * being taken with Playwright's `animations: "disabled"`, which cancelled the
 * spinner to rotation zero and raced the recorder's own scrub. Once that was
 * fixed, six consecutive runs came out byte-identical with no flags at all.
 *
 * Every flag here would change every captured pixel, so the bar for adding one
 * is a measurement showing it fixes something. Keeping this function as the
 * single launch site is the point: there is now one place to put such a flag,
 * and one place to explain it.
 */
export const DETERMINISTIC_ARGS: string[] = [];

/** Launch Chromium the way every recorder command should. */
export function launchBrowser(
  options: { headless?: boolean } = {},
): Promise<Browser> {
  return chromium.launch({
    headless: options.headless ?? true,
    args: DETERMINISTIC_ARGS,
  });
}
