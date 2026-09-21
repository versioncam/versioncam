import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { loadConfig } from "../../loader.js";
import { formatInventory, inspectPage } from "../../inspect/inspect.js";
import { openAppPage } from "./open-app.js";

export async function inspect(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    strict: false,
    allowPositionals: true,
  });

  const config = await loadConfig(process.cwd());
  const path = (positionals[0] as string | undefined) ?? "/";

  const browser = await chromium.launch();
  try {
    const { page, context } = await openAppPage(browser, config, path);
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
}
