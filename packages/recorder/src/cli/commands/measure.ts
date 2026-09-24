import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { formatMeasurement, measureSelector } from "../../inspect/measure.js";
import { openAppPage } from "./open-app.js";

export async function measure(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    strict: false,
    allowPositionals: true,
  });

  const [path, selector] = positionals as string[];
  if (!path || !selector) {
    process.stderr.write("Usage: versioncam measure <path> <selector>\n");
    return 1;
  }

  const config = await loadConfig(process.cwd());
  const browser = await launchBrowser();
  try {
    const { page, context } = await openAppPage(browser, config, path);
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
}
