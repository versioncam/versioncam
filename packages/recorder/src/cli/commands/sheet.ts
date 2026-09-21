import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadConfig } from "../../loader.js";
import { contactSheet } from "../../render/render.js";

export async function sheet(argv: string[]): Promise<number> {
  const { positionals } = parseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
  });
  const id = positionals[0] as string | undefined;
  if (!id) {
    process.stderr.write("Usage: demos sheet <id>\n");
    return 1;
  }

  const config = await loadConfig(process.cwd());
  const dir = join(config.recordingsDir, id);
  if (!existsSync(join(dir, "timeline.json"))) {
    process.stderr.write(`No recording for "${id}".\n`);
    return 1;
  }

  const browser = await chromium.launch();
  try {
    const file = await contactSheet(browser, config, {
      kind: "recording",
      id,
      dir,
    });
    process.stdout.write(`${file}\n`);
    return 0;
  } finally {
    await browser.close();
  }
}
