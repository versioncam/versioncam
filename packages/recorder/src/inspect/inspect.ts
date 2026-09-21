import type { Page } from "playwright";

/**
 * What can a clip actually click?
 *
 * Choreography written from an app's source keeps reaching for controls that
 * are conditional, renamed, or — the case that cost a whole recording run —
 * never rendered at all. Every clip that worked was written after looking at
 * the running app instead. This is that look, as a function: the inventory an
 * author needs before writing a beat.
 */

export type Control = {
  role: "button" | "link" | "menuitem" | "tab" | "option";
  /** Accessible name: aria-label, else trimmed text. */
  name: string;
  testId: string | null;
  box: { x: number; y: number; w: number; h: number };
};

export type Field = {
  kind: "input" | "textarea" | "select";
  /** aria-label, else placeholder, else name. */
  name: string;
  testId: string | null;
  box: { x: number; y: number; w: number; h: number };
};

export type Inventory = {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  controls: Control[];
  fields: Field[];
  testIds: string[];
  /**
   * Observable Plot labels a mark group by its mark type, so a bar chart's
   * group is `bar` and a histogram's is `rect`. Reporting the counts saves an
   * author guessing which — a guess that silently matches nothing.
   */
  plotMarks: { label: string; drawn: number }[];
};

export async function inspectPage(page: Page): Promise<Inventory> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const nameOf = (el: Element) =>
      (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

    const controls: Control[] = [];
    const selectors: [string, Control["role"]][] = [
      ["button", "button"],
      ['[role="button"]', "button"],
      ["a[href]", "link"],
      ['[role="menuitem"]', "menuitem"],
      ['[role="tab"]', "tab"],
      ['[role="option"]', "option"],
    ];
    const seen = new Set<Element>();
    for (const [selector, role] of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);
        controls.push({
          role,
          name: nameOf(el) || "(unnamed)",
          testId: el.getAttribute("data-testid"),
          box: boxOf(el),
        });
      }
    }

    const fields: Field[] = [];
    for (const el of Array.from(
      document.querySelectorAll("input, textarea, select"),
    )) {
      if (!visible(el)) continue;
      const input = el as HTMLInputElement;
      fields.push({
        kind: el.tagName.toLowerCase() as Field["kind"],
        name:
          el.getAttribute("aria-label") ??
          input.placeholder ??
          input.name ??
          "(unnamed)",
        testId: el.getAttribute("data-testid"),
        box: boxOf(el),
      });
    }

    const testIds = [
      ...new Set(
        Array.from(document.querySelectorAll("[data-testid]"))
          .filter(visible)
          .map((el) => el.getAttribute("data-testid") ?? ""),
      ),
    ].filter(Boolean);

    const plotMarks: { label: string; drawn: number }[] = [];
    const groups = new Map<string, number>();
    for (const group of Array.from(document.querySelectorAll("[aria-label]"))) {
      const label = group.getAttribute("aria-label") ?? "";
      // Plot's mark groups are short type names and contain drawn shapes.
      if (label.length > 12 || !/^[a-z]+$/.test(label)) continue;
      const drawn = Array.from(
        group.querySelectorAll("rect, path, circle"),
      ).filter((s) => {
        const r = s.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      }).length;
      if (drawn > 0) groups.set(label, (groups.get(label) ?? 0) + drawn);
    }
    for (const [label, drawn] of groups) plotMarks.push({ label, drawn });

    return {
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      controls,
      fields,
      testIds,
      plotMarks,
    };
  });
}

/**
 * How many controls the text form prints.
 *
 * An application page can carry several hundred, and this inventory is read
 * by something with a context budget: a wall of button geometry crowds out
 * the page it was meant to describe. Sixty is about a screen and a half, and
 * enough to find the beat's target on every page we have measured. The count
 * of what was left out is printed, so a trimmed list is never mistaken for
 * the whole page, and `--json` is never trimmed.
 */
const MAX_PRINTED_CONTROLS = 60;

/** The inventory as something a person reads in a terminal. */
export function formatInventory(inventory: Inventory): string {
  const lines: string[] = [
    `${inventory.title} — ${inventory.url}`,
    `viewport ${inventory.viewport.width}x${inventory.viewport.height}`,
    "",
    `controls (${inventory.controls.length}):`,
  ];
  const printed = inventory.controls.slice(0, MAX_PRINTED_CONTROLS);
  for (const c of printed) {
    const id = c.testId ? `  [${c.testId}]` : "";
    lines.push(
      `  ${c.role.padEnd(8)} ${c.name}${id}  @ ${c.box.x},${c.box.y} ${c.box.w}x${c.box.h}`,
    );
  }
  const dropped = inventory.controls.length - printed.length;
  if (dropped > 0) {
    lines.push(`  … ${dropped} more not shown; \`--json\` lists all of them.`);
  }
  lines.push("", `fields (${inventory.fields.length}):`);
  // With geometry, like the controls: a field is a click target before it is a
  // typing target, and without a box an author cannot tell which of two
  // similarly named inputs is the one on screen.
  for (const f of inventory.fields) {
    const id = f.testId ? `  [${f.testId}]` : "";
    lines.push(
      `  ${f.kind.padEnd(8)} ${f.name}${id}  @ ${f.box.x},${f.box.y} ${f.box.w}x${f.box.h}`,
    );
  }
  if (inventory.plotMarks.length > 0) {
    lines.push("", "plot mark groups:");
    for (const m of inventory.plotMarks) {
      lines.push(`  aria-label="${m.label}"  ${m.drawn} drawn`);
    }
  }
  lines.push("", `test ids: ${inventory.testIds.join(" · ") || "(none)"}`);
  return lines.join("\n");
}
