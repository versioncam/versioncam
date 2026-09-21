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

/** The inventory as something a person reads in a terminal. */
export function formatInventory(inventory: Inventory): string {
  const lines: string[] = [
    `${inventory.title} — ${inventory.url}`,
    `viewport ${inventory.viewport.width}x${inventory.viewport.height}`,
    "",
    `controls (${inventory.controls.length}):`,
  ];
  for (const c of inventory.controls) {
    const id = c.testId ? `  [${c.testId}]` : "";
    lines.push(
      `  ${c.role.padEnd(8)} ${c.name}${id}  @ ${c.box.x},${c.box.y} ${c.box.w}x${c.box.h}`,
    );
  }
  lines.push("", `fields (${inventory.fields.length}):`);
  for (const f of inventory.fields) {
    const id = f.testId ? `  [${f.testId}]` : "";
    lines.push(`  ${f.kind.padEnd(8)} ${f.name}${id}`);
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
