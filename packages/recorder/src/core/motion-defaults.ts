/**
 * The numbers that decide whether a clip looks human or looks generated.
 *
 * Each one is a judgement, not a constant of nature, so each carries the
 * reason it is what it is. Tune them with the render page's scrubber, then
 * write down what was wrong before.
 */
export const MOTION = {
  /**
   * Pause after arriving somewhere before doing anything. Without it the
   * click lands on the same frame the cursor stops, which reads as a machine
   * hitting a coordinate rather than a person deciding.
   */
  hoverDwellMs: 220,

  /** Dwell before a click, drawn from this range so it is never metronomic. */
  clickDwellMinMs: 80,
  clickDwellMaxMs: 150,

  /** How long the button stays down. Below ~60 ms the press is invisible. */
  pressMinMs: 70,
  pressMaxMs: 100,

  /**
   * A lasso stroke. Much faster and the shape reads as a scribble; much
   * slower and the clip has no room for anything else.
   */
  lassoDurationMs: 1400,

  /**
   * Camera moves. Longer than a cursor move on purpose: the camera carries the
   * whole frame, so at 700ms it reads as a snap even with min-jerk easing and
   * geometric interpolation. Around a second is where it stops calling
   * attention to itself.
   */
  zoomDurationMs: 1100,

  /**
   * Default magnification, and the point past which a zoom stops being free.
   *
   * A 1440-wide viewport captured at DPR 2 is 2880 real pixels. The app frame
   * inside a 1920-wide output is about 1750. Reading 2880/Z source pixels into
   * 1750 output pixels stays 1:1 only while Z <= 2880/1750, so 1.65 is where
   * upscaling begins — not 1.85, which was arithmetic done backwards.
   *
   * Deep zooms are therefore not the way to make small UI readable. Use the
   * app's own affordances instead: the chat panel has a "Full view".
   */
  defaultZoom: 1.5,
  maxZoom: 1.65,

  /** Padding around a zoom target, as a fraction of its size. */
  zoomPad: 0.12,

  /**
   * How far in a camera that follows the cursor goes. Gentler than a zoom's
   * 1.5, because a zoom frames one thing and stops, while a follow keeps the
   * cursor in frame as it travels and needs more of the page around it to
   * say where it is going. A website review that found clips zooming in and
   * out too much settled on this: in a little, once, and pan.
   */
  followZoom: 1.35,

  /**
   * The share of a following camera's frame, around its centre, that the
   * cursor can move within without the camera answering. At 1.35× on a page
   * 1440 wide that is 160 pixels either side and 100 up or down: a move to
   * the next field of a form stays inside it, a move across the page does
   * not. Much smaller and the camera fidgets with every small movement.
   */
  followDeadZone: 0.3,

  /**
   * How softly a following camera moves: the time it would take over a move
   * the cursor made at once, 3% to 97% of the way. The camera runs over the
   * cursor's whole path, so it has no lag to trade against; larger is
   * smoother, and sets off earlier before each move the cursor makes. At
   * 600, with the dead zone above, it sets off within about a tenth of a
   * second of the cursor and comes to rest about a fifth of a second after
   * the cursor stops: close enough to read as following, soft enough that a
   * pan across the page never lurches. With no dead zone it would lead the
   * cursor by a quarter of a second, which starts to read as a camera that
   * moved first.
   */
  followSmoothingMs: 600,

  /** How long a highlight stays up if the script does not say. */
  highlightMs: 1800,

  /** Click ripple, in the renderer. */
  rippleMs: 400,
  /** How far the ripple grows, in output pixels. */
  rippleRadius: 34,

  /** Cursor glyph scale while pressed, and how long it takes to get there. */
  pressScale: 0.9,
  pressScaleMs: 120,

  /** Frames a post-settle crossfade lasts. Six at 60 fps is 100 ms. */
  crossfadeFrames: 6,

  /** Caption fade, in seconds. */
  captionFadeS: 0.3,
} as const;
