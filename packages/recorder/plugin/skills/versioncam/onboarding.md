# The first run: setting a repository up

There is no `versioncam.config.ts` in this repository, so before any clip can
be written the repository has to be taught three things: how its app starts,
whether it signs in, and what "the page is done" means. Then one question has
to be answered before anything is authored: **does this app record the same
way twice?** A clip is only as deterministic as the app it films, and one
written against an app that is not fails CI for reasons nobody wrote.

You do not run the app yourself — not with `npm run dev`, not in the
background, not ever in this phase. You write what you learn into the config,
and `versioncam` starts the app from it, every time, and stops it again. If
you find yourself wanting to start a server by hand, the config is wrong;
fix the config.

Work in the app's directory, the one step 0 of the skill chose: the config
goes there, and every `versioncam` command reads it from there. Step 0 found
no `versioncam.config.*` anywhere in the repository, so this is the only one.
A second would split the repository in two.

## 1. How the app runs

Look, in this order, and stop when the answer is clear:

- `package.json` `scripts` — `dev`, then `start`, then `serve`. A script's own
  `--port` flag is the port. In a monorepo, the package whose scripts start
  the web app, which may be a directory below this one.
- The framework's config for the port — `vite.config.*` (`server.port`),
  `next.config.*`, `angular.json`, `astro.config.*` — and, if it says nothing,
  the framework's default: Vite and SvelteKit 5173, Next and Remix 3000,
  Astro 4321, Angular 4200.
- `Makefile`, `Procfile`, `docker-compose.yml`, and the README's
  getting-started section, for anything that needs more than one process.

From that, the config's `baseUrl` and `webServer`:

```ts
baseUrl: "http://localhost:<port>",
webServer: { command: "<the command a person would type>", url: "http://localhost:<port>" },
```

`command` runs through a shell from the config's directory; add `cwd` when it
has to run from somewhere else (`cwd: "../.."` for a repository root two levels
up). A stack of several services started by one command — a `make start`, a
`docker compose up` — needs `url` pointed at the service that is ready *last*,
usually a backend's health endpoint, not at the page: a dev server answers
seconds before the API behind it, and a clip that opens then meets a sign-in
form with nothing to sign in to. Give such a stack `timeoutMs: 180_000`.

**If the port comes from an environment variable, or there are several
plausible commands, ask** — with `AskUserQuestion`, listing the candidates
you found and what each would start. If nothing plausible turned up, ask what
starts the app. If you cannot ask (no one is there: the question tool is not
available or errors), take the most specific candidate, and say in your final
report which one you took and why.

**Never read a value out of any `.env` file.** A port, a URL, a key: if it is
only in a `.env`, it is a question for the person, not a file for you to open.

## 2. Whether it signs in

Look for sign-in routes, a login component, a redirect on `/` in the router.
Step 5 below will show it for certain — `inspect /` of an app behind a
sign-in lists a login form — so this is a first look, not the verdict.

If it does sign in, the choice is the person's, asked once:

- **`versioncam login`** — a browser opens, they sign in the way they always
  do, and the session is saved to a file that stays out of git. The right
  default when a person is there. Config: `auth: { storageState:
  ".versioncam/auth.json" }`, and they run `npx versioncam login` themselves;
  you cannot, because it waits for them.
- **A `login` hook** reading named variables from `.env.recording` — the right
  one for CI. You write the hook with the variable *names*
  (`process.env.RECORDING_USER`, say); they put the values in
  `.env.recording`, which is gitignored.

Never write a secret anywhere — not into the config, not into a clip, not into
your report — and never go looking for one. With no one to ask, stop here and
say what the person needs to do: nothing below works on a sign-in screen.

## 3. Write the config

`versioncam.config.ts` in the app's directory, with only what the app needs:

```ts
import { defineRecorder } from "versioncam";

export default defineRecorder({
  baseUrl: "http://localhost:5173",
  webServer: { command: "npm run dev", url: "http://localhost:5173" },
  viewport: { width: 1440, height: 900 },
  clips: "demos/clips/**/*.clip.ts",
});
```

Plus `auth` if step 2 said so, and `cursorStart` if step 7 says so. Not
`settle`, not `review`, not `theme`: every default is there because it is right
for most apps, and a field nobody needed is a question the next person has to
answer. Say in a comment above each field you did write why it has the value
it has — the port came from the dev script, the command from the README.

Then: create `demos/clips/` in the app's directory, and make sure
`.versioncam/` is ignored — recordings, renders and a saved sign-in go there.
If a `.gitignore` in the app's directory, or in a directory above it up to
the repository root, already says so, leave it; otherwise add the line to the
nearest one, creating one in the app's directory if there is none, and leave
the rest of the file alone.

## 4. `npx versioncam doctor`

It checks the machine, loads the config, and starts the app through
`webServer` exactly as every later command will, then stops it. **It must
pass.** If the app check fails, the reason is in its last lines and in
`.versioncam/webserver.log`: the wrong command, the wrong port, a port already
taken. Fix the config and run it again. Do not go on until it passes.

## 5. `npx versioncam inspect /`

What is on the start page, as a clip will see it. Three things to look for:

- **A sign-in form.** Step 2 was wrong; go back to it.
- **A loading screen, or a warning that a settle timed out.** The app needs
  `settle.ready`: a function that says when the page is really done. Find what
  "loaded" means here — a map's `loaded()`, a canvas that has drawn, a
  spinner's test id gone — add it to the config, and inspect again.
- **An empty page.** The app may need a path other than `/`, or data it does
  not have; say so.

## 6. Stability

Write `demos/clips/00-open.clip.ts` — open the start page, one caption, hold
three seconds:

```ts
import { clip } from "versioncam";

export default clip("00-open", { title: "The app opens", seed: 1 }, async (s) => {
  await s.open("/");
  s.caption("<the app's name>");
  await s.hold(3000);
});
```

Then:

```bash
npx versioncam stability 00-open
```

It records the clip twice and compares every frame. `stable` is the answer
that lets you go on. `unstable` prints the first frame that differs and saves
the two pictures behind it; **read both** and say what differs.

What you may fix, in the config:

- Something still animating in when the clip starts — a fade, a skeleton
  screen: a `settle.ready` that waits for it to finish.
- Time rendered from the server rather than the page: the page's own clock is
  already fixed (`clock.time`), so a timestamp that still moves came from an
  API, and that is the next item.

What you may not: **live data** — a feed, a count that changes, a model's
answer. That needs recorded network replay, which versioncam does not have
yet. Say so, and ask whether to go on regardless.

**Never author on an unstable app without saying so** — in the report now,
and in `summary.json` at the end, as `"stable": false`. A clip written against
an app that does not reproduce will fail CI, and whoever reads the failure
deserves to know it was known.

## 7. The first frame

```bash
npx versioncam record --draft 00-open
npx versioncam frame 00-open 0
```

Look at where the cursor is. Every clip starts it there, and it is taken
before a clip's first line runs, so no clip can move it. The default,
`(0.72, 0.28)` of the viewport, was picked for one app's open map and lands on
a list row or a field in others — and a reviewer fails a clip whose first
frame has the cursor on a control, a row or a field. If it is on one, set
`cursorStart` in the config to open space — a margin, the gap below a panel —
as fractions of the viewport, with a comment saying what is there, and look
at frame 0 again.

## 8. Report

Before going on to the clip, say — in a few lines:

- what you found (the command, the port, and where each came from);
- what you asked, and what the answer was — or what you assumed and why;
- that `stability` passed on `00-open`, or what differed;
- the files you created or changed — the config, `demos/clips/00-open.clip.ts`,
  `.gitignore` — and that **nothing was committed**: reviewing and committing
  them is the person's job.

Then go back to the skill and continue with the clip.
