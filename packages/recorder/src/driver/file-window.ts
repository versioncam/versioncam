/**
 * A file window drawn over the page, to drag files from.
 *
 * Uploading is half of what a data app does, and the browser's own file
 * dialog is outside the page: nothing can film it, and a file that simply
 * appears in an upload list reads as a cut. The first app this recorded
 * solved it with a small window drawn in the page, listing the files, from
 * which the cursor drags them onto the app's own dropzone; nothing in it was
 * that app's, so it is here. It looks like a Finder window, because the
 * clips it sits in show a Mac's cursor.
 *
 * It is staged, and a clip that uses it should say so where its clips are
 * shown. What is real is the drop: letting go over the page sends the
 * element under the pointer the `dragenter`, `dragover` and `drop` events a
 * real drag sends, carrying `File` objects with the names, types and
 * contents given, so the app takes them through its own dropzone, its own
 * accept rules and its own list, as it takes a person's.
 *
 * Selection works as in Finder: a click selects one row, a click with Shift
 * extends to it, a click with Meta or Control adds or removes it, and a
 * press on a selected row drags the whole selection. Its motion runs on
 * `requestAnimationFrame`, which the recorder's clock drives, so it opens
 * and closes at the same pace on every run.
 */

export type StagedFile = {
  /** What the window lists, and the dropped `File`'s name. */
  name: string;
  /** The dropped file's contents. Default empty. */
  content?: string;
  /** Its MIME type. Default from the extension. */
  type?: string;
  /** The Size column. Default from the contents. */
  size?: string;
};

export type FileWindowOptions = {
  /** The title bar. Default "Files". */
  title?: string;
  /**
   * Where the window's top left corner sits, as fractions of the viewport.
   * Default `{ x: 0.52, y: 0.42 }`, to the right of centre, where a sidebar's
   * dropzone on the left stays in view.
   */
  at?: { x: number; y: number };
};

/** The extension's kind, as Finder words it, and its MIME type. */
const KINDS: Record<string, { kind: string; type: string }> = {
  csv: { kind: "CSV document", type: "text/csv" },
  tsv: { kind: "TSV document", type: "text/tab-separated-values" },
  json: { kind: "JSON document", type: "application/json" },
  txt: { kind: "Plain Text", type: "text/plain" },
  fasta: { kind: "FASTA document", type: "text/plain" },
  fa: { kind: "FASTA document", type: "text/plain" },
  png: { kind: "PNG image", type: "image/png" },
  jpg: { kind: "JPEG image", type: "image/jpeg" },
  pdf: { kind: "PDF document", type: "application/pdf" },
  xlsx: {
    kind: "Microsoft Excel workbook",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

/** A row as the page draws it: every column worked out here, not there. */
export type FileRow = {
  name: string;
  content: string;
  type: string;
  size: string;
  kind: string;
};

export function fileRows(files: readonly StagedFile[]): FileRow[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("fileWindow: list at least one file, as { name }.");
  }
  return files.map((file, i) => {
    if (typeof file?.name !== "string" || file.name.length === 0) {
      throw new TypeError(`fileWindow: file ${i} has no name.`);
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const known = KINDS[ext];
    const content = file.content ?? "";
    const bytes = new TextEncoder().encode(content).length;
    return {
      name: file.name,
      content,
      type: file.type ?? known?.type ?? "application/octet-stream",
      size:
        file.size ??
        (bytes === 1
          ? "1 byte"
          : bytes < 1024
            ? `${bytes} bytes`
            : `${Math.round(bytes / 1024)} KB`),
      kind: known?.kind ?? "Document",
    };
  });
}

/**
 * Runs in the page: draws the window and wires its selection and its drag.
 * Self-contained, as everything handed to `page.evaluate` must be.
 */
export function drawFileWindow(args: {
  rows: FileRow[];
  title: string;
  left: number;
  top: number;
}): void {
  const doc = document;
  doc.getElementById("vc-file-window")?.remove();
  const style = doc.createElement("style");
  style.id = "vc-file-window-style";
  style.textContent = `
    #vc-file-window { position: fixed; z-index: 2147483000; width: 480px; border-radius: 10px;
      overflow: hidden; background: #ffffff; color: #1d1d1f; opacity: 0;
      box-shadow: 0 18px 50px rgba(15, 15, 40, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.12);
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
    #vc-file-window .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
      background: #ececec; border-bottom: 1px solid #d9d9d9; }
    #vc-file-window .dot { width: 12px; height: 12px; border-radius: 50%; }
    #vc-file-window .title { flex: 1; text-align: center; margin-right: 52px; font-weight: 600; color: #4a4a4a; }
    #vc-file-window .head, #vc-file-window .row { display: grid; grid-template-columns: 1fr 80px 150px;
      gap: 8px; align-items: center; padding: 0 14px; }
    #vc-file-window .head { height: 26px; color: #8a8a8e; font-size: 11px; border-bottom: 1px solid #eeeeee; }
    #vc-file-window .row { height: 30px; cursor: default; user-select: none; }
    #vc-file-window .row:nth-child(odd) { background: #f6f6f8; }
    #vc-file-window .row.selected { background: #2f6fde; color: #ffffff; }
    #vc-file-window .name { display: flex; align-items: center; gap: 8px; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    #vc-file-window .muted { color: #8a8a8e; white-space: nowrap; }
    #vc-file-window .row.selected .muted { color: #dbe6ff; }
    #vc-file-window .foot { height: 24px; display: flex; align-items: center; justify-content: center;
      color: #8a8a8e; font-size: 11px; border-top: 1px solid #eeeeee; background: #fafafa; }
    #vc-file-ghost { position: fixed; z-index: 2147483001; pointer-events: none; display: flex;
      align-items: center; gap: 6px; padding: 5px 9px; border-radius: 6px; background: rgba(47, 111, 222, 0.92);
      color: #ffffff; font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2); }
    #vc-file-ghost .count { background: #ff3b30; border-radius: 9px; padding: 0 6px; font-weight: 600; }
  `;
  doc.getElementById("vc-file-window-style")?.remove();
  doc.head.append(style);

  const icon = (kind: string) => {
    const colour = /image/i.test(kind)
      ? "#f4b400"
      : /PDF/.test(kind)
        ? "#ea4335"
        : "#34a853";
    return `<svg width="14" height="17" viewBox="0 0 14 17" aria-hidden="true"><path d="M1 1h8l4 4v11H1z" fill="#fff" stroke="#9a9aa2"/><path d="M9 1v4h4" fill="none" stroke="#9a9aa2"/><rect x="3" y="9" width="8" height="5" rx="1" fill="${colour}"/></svg>`;
  };
  const text = (value: string) => {
    const span = doc.createElement("span");
    span.textContent = value;
    return span.innerHTML;
  };

  const win = doc.createElement("div");
  win.id = "vc-file-window";
  win.style.left = `${args.left}px`;
  win.style.top = `${args.top}px`;
  win.innerHTML = `
    <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span><span class="title">${text(args.title)}</span></div>
    <div class="head"><span>Name</span><span>Size</span><span>Kind</span></div>
    <div class="rows">${args.rows
      .map(
        (row, i) =>
          `<div class="row" data-vc-file="${i}"><span class="name">${icon(row.kind)}${text(row.name)}</span>` +
          `<span class="muted">${text(row.size)}</span><span class="muted">${text(row.kind)}</span></div>`,
      )
      .join("")}</div>
    <div class="foot">${args.rows.length} ${args.rows.length === 1 ? "item" : "items"}</div>`;
  doc.body.append(win);

  const fade = (from: number, to: number, ms: number, done?: () => void) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (to - from) * eased;
      win.style.opacity = String(value);
      win.style.transform = `translateY(${(1 - value) * 10}px)`;
      if (t < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  };
  fade(0, 1, 280);

  const rowEls = [...win.querySelectorAll<HTMLElement>(".row")];
  const selected = new Set<number>();
  let anchor = 0;
  const paint = () =>
    rowEls.forEach((el, i) => el.classList.toggle("selected", selected.has(i)));

  const transfer = () => {
    const dt = new DataTransfer();
    for (const i of [...selected].sort((a, b) => a - b)) {
      const row = args.rows[i];
      dt.items.add(new File([row.content], row.name, { type: row.type }));
    }
    return dt;
  };
  const fire = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        dataTransfer: transfer(),
      }),
    );
  const underPointer = (x: number, y: number): Element | null => {
    const el = doc.elementFromPoint(x, y);
    return el && !win.contains(el) ? el : null;
  };

  let pressed: { x: number; y: number } | null = null;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;

  for (const [i, el] of rowEls.entries()) {
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (event.shiftKey) {
        selected.clear();
        for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k += 1)
          selected.add(k);
      } else if (event.metaKey || event.ctrlKey) {
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        anchor = i;
      } else if (!selected.has(i)) {
        selected.clear();
        selected.add(i);
        anchor = i;
      }
      paint();
      pressed = selected.has(i) ? { x: event.clientX, y: event.clientY } : null;
    });
  }

  doc.addEventListener("mousemove", (event) => {
    if (!pressed) return;
    if (!ghost) {
      // A few pixels first, as a real drag waits for, so a click with a
      // slightly unsteady hand selects and does not drag.
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 4)
        return;
      ghost = doc.createElement("div");
      ghost.id = "vc-file-ghost";
      const first = args.rows[Math.min(...selected)];
      ghost.innerHTML =
        `${icon(first.kind)}${text(first.name)}` +
        (selected.size > 1
          ? `<span class="count">${selected.size}</span>`
          : "");
      doc.body.append(ghost);
    }
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY + 10}px`;
    const target = underPointer(event.clientX, event.clientY);
    if (over && target !== over)
      fire(over, "dragleave", event.clientX, event.clientY);
    if (target && target !== over)
      fire(target, "dragenter", event.clientX, event.clientY);
    if (target) fire(target, "dragover", event.clientX, event.clientY);
    over = target;
  });

  doc.addEventListener("mouseup", (event) => {
    const dragging = ghost !== null;
    pressed = null;
    if (!dragging) return;
    ghost?.remove();
    ghost = null;
    const target = underPointer(event.clientX, event.clientY);
    over = null;
    if (!target) return;
    fire(target, "drop", event.clientX, event.clientY);
    // The files have gone where they were dropped, and the window with them.
    fade(1, 0, 220, () => win.remove());
  });

  (
    window as unknown as { __vcCloseFileWindow?: () => void }
  ).__vcCloseFileWindow = () => fade(1, 0, 220, () => win.remove());
}
