import { clip } from "@living-demos/recorder";

/**
 * A destructive action behind a confirmation.
 *
 * The dialog is a native `<dialog>` opened with `showModal()`, which sits in
 * the top layer and is the sort of element naive automation trips over. The
 * driver treats it as any other part of the page, because it moves a real
 * mouse over a real element.
 */
export default clip(
  "03-cancel-a-shipment",
  { title: "Cancel a shipment", seed: 33 },
  async (s) => {
    await s.open("/");
    s.caption("Cancel a shipment");
    await s.hold(400);

    await s.click(s.byTestId("cancel-3"));
    await s.settle({ label: "dialog open" });
    await s.hold(700);

    await s.camera.zoom(s.byTestId("confirm-dialog"), 1.6);
    await s.hold(900);

    await s.click(s.byTestId("confirm-cancel"));
    await s.settle({ label: "cancelled" });
    s.camera.reset();
    await s.hold(500);

    // The list, not the status line under it: `list-status` measures at y 928
    // in an 800-pixel viewport, so a ring around it is drawn below the fold and
    // appears in no frame. `demos review` warns about that now; it did not when
    // this clip was written, and the ring had been invisible ever since.
    await s.highlight(s.byTestId("shipments"), "ring", { for: 1500 });
    await s.hold(1600);
  },
);
