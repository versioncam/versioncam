/**
 * The fixed half of the clip's look.
 *
 * What an app chooses — its accent, whether there is a backdrop and a device
 * frame at all — comes from the config. What is here is the craft that should
 * not vary between apps: corner radii, shadow weights, the cursor's geometry,
 * the caption's type. An app that wants these different is asking for a
 * different renderer, not a different config.
 */
export const CHROME = {
  /** Device frame, used only when presentation asks for one. */
  radius: 16,
  hairline: "rgba(255, 255, 255, 0.16)",
  shadow: "rgba(0, 0, 0, 0.45)",
  shadowBlur: 60,
  shadowOffsetY: 18,

  captionFont:
    '600 30px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  captionColor: "rgba(255, 255, 255, 0.94)",
  captionShadow: "rgba(0, 0, 0, 0.5)",
  /** The band a caption sits on when it overlays the app rather than the padding. */
  captionScrim: "rgba(0, 0, 0, 0.45)",
  captionScrimHeight: 86,

  cursorFill: "#ffffff",
  cursorStroke: "rgba(0, 0, 0, 0.55)",
  cursorShadow: "rgba(0, 0, 0, 0.35)",

  ringWidth: 3,
  ringRadius: 10,
  spotlightDim: 0.55,
  spotlightTint: "6, 2, 16",
} as const;

/**
 * `#rrggbb` plus an alpha, for the ring's glow.
 *
 * Falls back to the colour untouched if it is not a hex triple, so a config
 * can use `rgb()` or a named colour and only lose the glow.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return color;
  const n = Number.parseInt(hex[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
