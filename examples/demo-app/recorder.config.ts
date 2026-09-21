import { defineRecorder } from "@living-demos/recorder";

/**
 * How this app describes itself to the recorder.
 *
 * Almost everything is a default. What an app usually has to say is: where it
 * is served, how to sign in, and what "the page is done" means beyond a quiet
 * DOM and an idle network. This one needs no sign-in and nothing special to
 * wait for, which is what a config should look like when an app is
 * straightforward.
 */
export default defineRecorder({
  baseUrl: process.env.DEMOS_BASE_URL ?? "http://localhost:5174",
  viewport: { width: 1280, height: 800 },
  clips: "demos/clips/**/*.clip.ts",
  scenes: "demos/scenes/index.ts",

  theme: {
    accent: "#2f6fed",
    // Presentation is left off: these clips are of the product, at the
    // viewport's own aspect. Turning it on would put them on a backdrop, in a
    // rounded device frame, with the caption below.
    //
    // presentation: { backdrop: ["#10131a", "#233056"], frame: true, padding: 0.045 },
  },

  sequence: [
    "01-create-a-shipment",
    "02-find-a-shipment",
    "03-cancel-a-shipment",
    "what-a-clip-is",
  ],
});
