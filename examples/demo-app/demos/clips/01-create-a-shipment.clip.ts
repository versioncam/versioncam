import { clip } from "@living-demos/recorder";

/**
 * Filling in a form and waiting for the result.
 *
 * The app takes 800ms to create a shipment and shows a spinner while it does.
 * Neither appears in the clip as a wait: `settle()` advances the page's clock
 * without capturing, so the eight hundred milliseconds never reach the video —
 * which is the whole point of authoring time rather than measuring it.
 */
export default clip(
  "01-create-a-shipment",
  { title: "Create a shipment", seed: 11 },
  async (s) => {
    await s.open("/");
    s.caption("Create a shipment");
    await s.hold(400);

    await s.typeInto(s.byTestId("recipient"), "Mira Halloran");
    await s.hold(150);
    await s.typeInto(s.byTestId("destination"), "Reykjavík");
    await s.hold(250);

    await s.click(s.byTestId("create-shipment"));
    // The spinner, held for a beat so it reads as work rather than as a
    // flicker, then the wait itself edited out.
    await s.hold(600);
    await s.settle({ label: "shipment created" });
    await s.hold(400);

    await s.camera.zoom(s.byTestId("shipment-13"), 1.5);
    await s.highlight(s.byTestId("shipment-13"), "ring", { for: 1600 });
    await s.hold(1700);
  },
);
