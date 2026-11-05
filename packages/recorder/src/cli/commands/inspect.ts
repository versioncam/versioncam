import { parseArgs } from "node:util";
import { launchBrowser } from "../../driver/launch.js";
import { loadConfig } from "../../loader.js";
import { formatInventory, inspectPage } from "../../inspect/inspect.js";
import { drivingApp } from "../app.js";
import { openAppPage, viewportOf } from "./open-app.js";

export async function inspect(argv: string[]): Promise<number> {
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

  const config = await loadConfig(process.cwd());
  const path = (positionals[0] as string | undefined) ?? "/";

  return drivingApp(config, async () => {
    const browser = await launchBrowser();
    try {
      const { page, context } = await openAppPage(
        browser,
        config,
        path,
        viewport,
      );
      const inventory = await inspectPage(page);
      process.stdout.write(
        values.json
          ? `${JSON.stringify(inventory, null, 2)}\n`
          : `${formatInventory(inventory)}\n`,
      );
      await context.close();
      return 0;
    } finally {
      await browser.close();
    }
  });
}
