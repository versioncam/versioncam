import type { Page } from "playwright";
import type { Rect } from "../core/timeline.js";

/**
 * Where the things matching a selector actually are.
 *
 * A drag or a lasso is authored as fractions of a target's box, and fractions
 * chosen by guesswork enclose nothing — which is silent, because an empty
 * selection is a legal state that simply fails to render whatever depended on
 * it. Measuring first is what made every working stroke in the prototype work.
 */

/**
 * Above this many matches, a list of boxes is a wall of numbers and the grid
 * is the answer. Below it, the boxes are the answer: a handful of markers is
 * exactly the case where an author needs to know where each one is.
 */
const MAX_LISTED = 12;

export type Measurement = {
  selector: string;
  count: number;
  /**
   * Each match's own box, while there are few enough to read. Empty above
   * `MAX_LISTED`, where `bounds` and `grid` are what a stroke is planned from.
   */
  boxes: Rect[];
  /**
   * What each listed match says, trimmed, beside its box — so a status line
   * can be read before a beat promises what it will say. `inspect` names
   * controls and fields and says nothing of the text around them, which left
   * an author opening the app by hand to learn what "1 of 12" looked like.
   */
  texts: string[];
  /** Union of every match's box, in viewport pixels. */
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
  return page.evaluate(
    ({ sel, maxListed }) => {
      const cols = 12;
      const rows = 8;
      const grid: number[][] = Array.from({ length: rows }, () =>
        new Array<number>(cols).fill(0),
      );
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const matches = Array.from(document.querySelectorAll(sel));
      const boxes = matches.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      // `innerText` where there is one: it is the text as rendered, so a hidden
      // span does not speak and a line break is a space. SVG has only
      // `textContent`. Long text is cut, because a match can be a whole list.
      const texts = matches.map((el) => {
        const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
        const text = raw.replace(/\s+/g, " ").trim();
        return text.length > 80 ? `${text.slice(0, 79)}…` : text;
      });

      if (boxes.length === 0) {
        return {
          selector: sel,
          count: 0,
          boxes: [],
          texts: [],
          bounds: null,
          fractions: null,
          viewport,
          grid,
        };
      }

      // Over boxes, not over centres. Centres collapse a single match to a
      // point — bounds of zero size, from which no framing can be planned —
      // and understate a cluster by half an element on every side.
      const bounds = {
        x0: Math.min(...boxes.map((b) => b.x)),
        y0: Math.min(...boxes.map((b) => b.y)),
        x1: Math.max(...boxes.map((b) => b.x + b.w)),
        y1: Math.max(...boxes.map((b) => b.y + b.h)),
      };

      // The grid stays a count of centres: it answers "where is the mass",
      // and a box spanning cells would smear that.
      for (const b of boxes) {
        const c = Math.min(
          cols - 1,
          Math.max(0, Math.floor(((b.x + b.w / 2) / viewport.width) * cols)),
        );
        const r = Math.min(
          rows - 1,
          Math.max(0, Math.floor(((b.y + b.h / 2) / viewport.height) * rows)),
        );
        grid[r][c] += 1;
      }

      return {
        selector: sel,
        count: boxes.length,
        boxes: boxes.length <= maxListed ? boxes : [],
        texts: boxes.length <= maxListed ? texts : [],
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
    },
    { sel: selector, maxListed: MAX_LISTED },
  );
}

export function formatMeasurement(m: Measurement): string {
  if (m.count === 0) return `${m.selector}: nothing matched.`;
  const b = m.bounds!;
  const f = m.fractions!;
  const lines = [
    `${m.selector}: ${m.count} match(es) in ${m.viewport.width}x${m.viewport.height}`,
    `  bounds px   x ${b.x0.toFixed(0)}–${b.x1.toFixed(0)}   y ${b.y0.toFixed(0)}–${b.y1.toFixed(0)}`,
    `  bounds frac x ${f.x0.toFixed(2)}–${f.x1.toFixed(2)}   y ${f.y0.toFixed(2)}–${f.y1.toFixed(2)}`,
  ];

  if (m.boxes.length > 0) {
    lines.push("  boxes:");
    for (const [index, box] of m.boxes.entries()) {
      lines.push(
        `    ${String(index).padStart(2)}  @ ${box.x.toFixed(0)},${box.y.toFixed(0)} ` +
          `${box.w.toFixed(0)}x${box.h.toFixed(0)}  text=${JSON.stringify(m.texts[index] ?? "")}`,
      );
    }
    return lines.join("\n");
  }

  lines.push("  density (rows = y, cols = x):");
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
