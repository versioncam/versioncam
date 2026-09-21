import type { Page } from "playwright";

/**
 * Where the things matching a selector actually are.
 *
 * A drag or a lasso is authored as fractions of a target's box, and fractions
 * chosen by guesswork enclose nothing — which is silent, because an empty
 * selection is a legal state that simply fails to render whatever depended on
 * it. Measuring first is what made every working stroke in the prototype work.
 */

export type Measurement = {
  selector: string;
  count: number;
  /** Union of every match, in viewport pixels. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The same, as fractions of the viewport, which is how strokes are written. */
  fractions: { x0: number; y0: number; x1: number; y1: number } | null;
  viewport: { width: number; height: number };
  /** Counts over a 12x8 grid, so the dense region is obvious without a screenshot. */
  grid: number[][];
};

export async function measureSelector(
  page: Page,
  selector: string,
): Promise<Measurement> {
  return page.evaluate((sel) => {
    const cols = 12;
    const rows = 8;
    const grid: number[][] = Array.from({ length: rows }, () =>
      new Array<number>(cols).fill(0),
    );
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const centres = Array.from(document.querySelectorAll(sel)).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (centres.length === 0) {
      return {
        selector: sel,
        count: 0,
        bounds: null,
        fractions: null,
        viewport,
        grid,
      };
    }

    const xs = centres.map((p) => p.x);
    const ys = centres.map((p) => p.y);
    const bounds = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };

    for (const p of centres) {
      const c = Math.min(
        cols - 1,
        Math.max(0, Math.floor((p.x / viewport.width) * cols)),
      );
      const r = Math.min(
        rows - 1,
        Math.max(0, Math.floor((p.y / viewport.height) * rows)),
      );
      grid[r][c] += 1;
    }

    return {
      selector: sel,
      count: centres.length,
      bounds,
      fractions: {
        x0: bounds.x0 / viewport.width,
        y0: bounds.y0 / viewport.height,
        x1: bounds.x1 / viewport.width,
        y1: bounds.y1 / viewport.height,
      },
      viewport,
      grid,
    };
  }, selector);
}

export function formatMeasurement(m: Measurement): string {
  if (m.count === 0) return `${m.selector}: nothing matched.`;
  const b = m.bounds!;
  const f = m.fractions!;
  const lines = [
    `${m.selector}: ${m.count} match(es) in ${m.viewport.width}x${m.viewport.height}`,
    `  bounds px   x ${b.x0.toFixed(0)}–${b.x1.toFixed(0)}   y ${b.y0.toFixed(0)}–${b.y1.toFixed(0)}`,
    `  bounds frac x ${f.x0.toFixed(2)}–${f.x1.toFixed(2)}   y ${f.y0.toFixed(2)}–${f.y1.toFixed(2)}`,
    "  density (rows = y, cols = x):",
  ];
  for (const [r, row] of m.grid.entries()) {
    const y = ((r + 0.5) / m.grid.length).toFixed(2);
    lines.push(
      `    y=${y} |` +
        row.map((v) => (v === 0 ? "    ." : String(v).padStart(5))).join(""),
    );
  }
  lines.push(
    "           x =" +
      Array.from({ length: 12 }, (_, c) =>
        ((c + 0.5) / 12).toFixed(2).slice(1).padStart(5),
      ).join(""),
  );
  return lines.join("\n");
}
