import { clip } from "versioncam";

/**
 * Narrowing a list by typing.
 *
 * Every keystroke re-renders, so this is the clip where per-frame capture and
 * deduplication meet: the list changes on most frames while the typing runs
 * and on none of them while it does not.
 */
export default clip(
  "02-find-a-shipment",
  { title: "Find a shipment", seed: 22 },
  async (s) => {
    await s.open("/");
    s.caption("Find a shipment");
    await s.hold(500);

    await s.camera.zoom(s.byTestId("shipments"), 1.35);
    await s.hold(400);

    await s.typeInto(s.byTestId("filter"), "berg");
    await s.settle({ label: "filtered" });
    await s.hold(900);

    await s.highlight(s.byTestId("list-status"), "ring", { for: 1500 });
    await s.hold(1000);
    s.camera.reset();
    await s.hold(800);
  },
);
