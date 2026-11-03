import { clip } from "versioncam";

/**
 * The example of a phone clip: `01-create-a-shipment` again, at a phone's
 * viewport, where the app lays itself out in one column.
 *
 * A clip's own `viewport` gives it its own shape, and a portrait one a
 * portrait video, `output.width` high: 888 by 1920 here. The `-mobile` on
 * the end of its id is what joins it to `01-create-a-shipment` on
 * version.cam: that clip's page, its embed and the `<version-cam>` element
 * show this one on a screen under 768 CSS pixels wide, so one link serves a
 * phone and a desktop. It stays out of the config's `sequence`, which
 * stitches clips of one size.
 *
 * The steps are the desktop clip's, by the same test ids. The zoom at the
 * end is gone: a phone frame is close enough already.
 */
export default clip(
  "01-create-a-shipment-mobile",
  {
    title: "Create a shipment, on a phone",
    seed: 17,
    viewport: { width: 390, height: 844 },
  },
  async (s) => {
    await s.open("/");
    s.caption("Create a shipment, on a phone");
    await s.hold(400);

    await s.typeInto(s.byTestId("recipient"), "Mira Halloran");
    await s.hold(150);
    await s.typeInto(s.byTestId("destination"), "Reykjavík");
    await s.hold(250);

    await s.click(s.byTestId("create-shipment"));
    await s.hold(600);
    await s.settle({ label: "shipment created" });
    await s.hold(400);

    await s.highlight(s.byTestId("shipment-13"), "ring", { for: 1600 });
    await s.hold(1700);
  },
);
