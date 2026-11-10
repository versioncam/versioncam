import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clip, runClip } from "../src/driver/clip.js";
import { launchBrowser } from "../src/driver/launch.js";
import { testConfig } from "./support.js";

/**
 * Recording a deployed app: the config's `headers` on the app's requests
 * and on no other host's, a sign-in that never reaches a replay file, and a
 * replay that answers the app on whatever host it is deployed to.
 *
 * Two real servers on two origins, each writing down the headers of every
 * request it gets: the app, and a host the app's page loads an image from
 * and redirects to, standing in for a font host, an analytics script and an
 * identity provider. What each server received is the test.
 */

const SECRET = "bypass-secret-7f3a9c";
const PASSWORD = "test-account-password-41d9";

type Seen = { path: string; headers: IncomingHttpHeaders };
let app: Server;
let other: Server;
let appUrl = "";
let otherUrl = "";
const seen: { app: Seen[]; other: Seen[] } = { app: [], other: [] };
let answered = 0;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test.beforeAll(async () => {
  app = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    seen.app.push({ path, headers: request.headers });
    if (path === "/page.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><body>
        <img src="${otherUrl}/pixel.png" width="1" height="1">
        <p data-testid="answer">waiting</p>
        <script>
          fetch("/api/answer").then((r) => r.json()).then((a) => {
            document.querySelector("[data-testid=answer]").textContent = a.text;
          });
        </script>
      </body></html>`);
    } else if (path === "/api/answer") {
      answered += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ text: "answered" }));
    } else if (path === "/api/sign-in") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ signedIn: true }));
    } else if (path === "/sign-in") {
      // An app sending its sign-in to an identity provider on another host.
      response.writeHead(302, { location: `${otherUrl}/authorize` });
      response.end();
    } else {
      response.writeHead(404).end();
    }
  });
  other = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    seen.other.push({ path, headers: request.headers });
    if (path === "/authorize") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<p>Sign in with the provider</p>");
    } else {
      response.writeHead(200, { "content-type": "image/png" });
      response.end();
    }
  });
  appUrl = await listen(app);
  otherUrl = await listen(other);
});

test.afterAll(() => {
  app.close();
  other.close();
});

test.beforeEach(() => {
  seen.app.length = 0;
  seen.other.length = 0;
});

test("the headers reach the app's requests, no other host's, and no replay file", async () => {
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "versioncam-headers-"));
  try {
    await runClip(
      browser,
      testConfig({
        baseUrl: appUrl,
        headers: { "X-Test-Bypass": SECRET, "x-test-empty": "" },
        replay: { record: ["**/api/**"], dir },
      }),
      clip("headers", { title: "Headers" }, async (s) => {
        await s.open("/page.html");
        await s.hold(100);
        expect(
          await s.offCamera((page) => page.getByTestId("answer").innerText()),
        ).toBe("answered");
      }),
      { replay: "record" },
    );

    const paths = seen.app.map((r) => r.path);
    expect(paths).toContain("/page.html");
    expect(paths).toContain("/api/answer");
    for (const request of seen.app) {
      expect(request.headers["x-test-bypass"]).toBe(SECRET);
      expect(request.headers["x-test-empty"]).toBeUndefined();
    }
    expect(seen.other.map((r) => r.path)).toContain("/pixel.png");
    for (const request of seen.other) {
      expect(request.headers["x-test-bypass"]).toBeUndefined();
    }

    // The replay fetched /api/answer with the header (the server saw it,
    // above) and wrote down neither its value nor its name.
    const files = readdirSync(dir);
    expect(files).toEqual(["headers.har"]);
    const har = readFileSync(join(dir, "headers.har"), "utf8");
    expect(har).toContain("/api/answer");
    expect(har).not.toContain(SECRET);
    expect(har.toLowerCase()).not.toContain('"x-test-bypass"');
    expect(har).toContain("the config's headers (x-test-bypass, x-test-empty)");
  } finally {
    await browser.close();
  }
});

test("a redirect that takes the headers to another host is named", async () => {
  // The one way they leave the app's origin: Chromium keeps a request's
  // headers through its redirects, and no route sees the hop.
  const browser = await launchBrowser();
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
  try {
    await runClip(
      browser,
      testConfig({ baseUrl: appUrl, headers: { "X-Test-Bypass": SECRET } }),
      clip("headers-redirect", { title: "Redirect" }, async (s) => {
        await s.open("/sign-in");
        await s.hold(100);
      }),
    );
    const host = new URL(otherUrl).host;
    const said = warned.join("\n");
    expect(said).toContain(`redirected a request to ${host}`);
    expect(said).toContain("X-Test-Bypass");
    expect(said).not.toContain(SECRET);
    // What the warning says happened, happened.
    expect(
      seen.other.find((r) => r.path === "/authorize")?.headers["x-test-bypass"],
    ).toBe(SECRET);
  } finally {
    console.warn = warn;
    await browser.close();
  }
});

test("a config whose headers are all empty sends none and says nothing", async () => {
  const browser = await launchBrowser();
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
  try {
    await runClip(
      browser,
      testConfig({ baseUrl: appUrl, headers: { "X-Test-Bypass": "" } }),
      clip("headers-empty", { title: "Empty" }, async (s) => {
        await s.open("/sign-in");
        await s.hold(100);
      }),
    );
    for (const request of [...seen.app, ...seen.other]) {
      expect(request.headers["x-test-bypass"]).toBeUndefined();
    }
    expect(warned.join("\n")).not.toContain("headers:");
  } finally {
    console.warn = warn;
    await browser.close();
  }
});

test("a sign-in in the login hook goes to the app and never into a replay", async () => {
  // A replay writes request bodies down, and a sign-in's body holds the
  // password: on 2026-11-10 one landed in a HAR this way (WP20, A1).
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "versioncam-sign-in-"));
  try {
    await runClip(
      browser,
      testConfig({
        baseUrl: appUrl,
        replay: { record: ["**/api/**"], dir },
        auth: {
          login: async (page) => {
            await page.evaluate(async (password) => {
              await fetch("/api/sign-in", {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                },
                body: `email=demo%40example.com&password=${password}`,
              });
            }, PASSWORD);
          },
        },
      }),
      clip("sign-in", { title: "Sign in" }, async (s) => {
        await s.open("/page.html");
        await s.hold(100);
      }),
      { replay: "record" },
    );
    expect(seen.app.map((r) => r.path)).toContain("/api/sign-in");
    const har = readFileSync(join(dir, "sign-in.har"), "utf8");
    expect(har).toContain("/api/answer");
    expect(har).not.toContain("/api/sign-in");
    expect(har).not.toContain(PASSWORD);
  } finally {
    await browser.close();
  }
});

test("a replay recorded on one host answers the app on another", async () => {
  // A preview has a new host for every commit; the replay has to answer
  // each one. 127.0.0.1 and localhost are the same server on two origins.
  const browser = await launchBrowser();
  const dir = mkdtempSync(join(tmpdir(), "versioncam-hosts-"));
  const body = clip("hosts", { title: "Hosts" }, async (s) => {
    await s.open("/page.html");
    await s.hold(100);
    expect(
      await s.offCamera((page) => page.getByTestId("answer").innerText()),
    ).toBe("answered");
  });
  try {
    await runClip(
      browser,
      testConfig({ baseUrl: appUrl, replay: { record: ["**/api/**"], dir } }),
      body,
      { replay: "record" },
    );
    const har = JSON.parse(readFileSync(join(dir, "hosts.har"), "utf8"));
    expect(har.log._versioncam.origin).toBe(appUrl);

    const before = answered;
    const elsewhere = appUrl.replace("127.0.0.1", "localhost");
    await runClip(
      browser,
      testConfig({
        baseUrl: elsewhere,
        replay: { record: ["**/api/**"], dir },
      }),
      body,
      { replay: "replay" },
    );
    // Served from the file: the server was not asked again.
    expect(answered).toBe(before);
  } finally {
    await browser.close();
  }
});
