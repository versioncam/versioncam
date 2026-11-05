import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { formatMeasurement, measureSelector } from "../../inspect/measure.js";
import { drivingApp } from "../app.js";
import { openAppPage, viewportOf } from "./open-app.js";

export async function measure(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" }, viewport: { type: "string" } },
    strict: false,
    allowPositionals: true,
  });
  const viewport = viewportOf(values.viewport);
  if (viewport instanceof Error) {
    process.stderr.write(`${viewport.message}\n`);
    return 1;
  }

  const [path, selector] = positionals as string[];
  if (!path || !selector) {
    process.stderr.write("Usage: versioncam measure <path> <selector>\n");
    return 1;
  }

  const config = await loadConfig(process.cwd());
  return drivingApp(config, async () => {
    const browser = await launchBrowser();
    try {
      const { page, context } = await openAppPage(
        browser,
        config,
        path,
        viewport,
      );
      const measurement = await measureSelector(page, selector);
      process.stdout.write(
        values.json
          ? `${JSON.stringify(measurement, null, 2)}\n`
          : `${formatMeasurement(measurement)}\n`,
      );
      await context.close();
      return measurement.count > 0 ? 0 : 1;
    } finally {
      await browser.close();
    }
  });
}
