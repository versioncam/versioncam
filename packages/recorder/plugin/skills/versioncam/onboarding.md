# The first run: setting a repository up

There is no `versioncam.config.ts` in this repository. Before anyone can write
a clip, you have to teach the repository three things: how its app starts,
whether it signs in, and what "the page is done" means. Then you answer one
question before anything is authored: **does this app record the same way
twice?** A clip is only as deterministic as the app it films. A clip written
against an app that is not deterministic fails CI for reasons nobody wrote.

You do not run the app yourself: not with `npm run dev`, not in the
background, not ever in this phase. You write what you learn into the config,
and `versioncam` starts the app from it, every time, and stops it again. If
you find yourself wanting to start a server by hand, the config is wrong;
fix the config.

Work in the app's directory, the one that step 0 of the skill chose. The config
goes there, and every `versioncam` command reads it from there. Step 0 found
no `versioncam.config.*` anywhere in the repository, so this config will be
the only one. A second would split the repository in two.

## 1. How the app runs

Look in this order, and stop when the answer is clear:

- `package.json` `scripts`: `dev`, then `start`, then `serve`. A script's own
  `--port` flag is the port. In a monorepo, look for the package whose
  scripts start the web app, which may be in a directory below this one.
- The framework's config for the port: `vite.config.*` (`server.port`),
  `next.config.*`, `angular.json`, `astro.config.*`, and, if it says nothing,
  the framework's default: Vite and SvelteKit 5173, Next, Nuxt, Remix and
  Docusaurus 3000, Astro 4321, Angular 4200, Django and Laravel 8000, Rails
  3000, Phoenix 4000.
- An app that is not Node has no `package.json` scripts to read. Its `command`
  is whatever starts it, from a virtual environment if that is where it lives:
  `.venv/bin/python manage.py runserver 8000`, `bin/rails server`.
- `Makefile`, `Procfile`, `docker-compose.yml`, and the README's
  getting-started section, for anything that needs more than one process.

From that, write the config's `baseUrl` and `webServer`:

```ts
baseUrl: "http://localhost:<port>",
webServer: { command: "<the command a person would type>", url: "http://localhost:<port>" },
```

`command` runs through a shell from the config's directory. Add `cwd` when it
has to run from somewhere else (`cwd: "../.."` for a repository root two levels
up). For a stack of several services started by one command (a `make start`, a
`docker compose up`), point `url` at the service that is ready *last*, usually
a backend's health endpoint, not at the page. A dev server answers seconds
before the API behind it, and a clip that opens then meets a sign-in
form with nothing to sign in to. Give such a stack `timeoutMs: 180_000`.

**If the port comes from an environment variable, or there are several
plausible commands, ask**, with `AskUserQuestion`, listing the candidates
you found and what each would start. If nothing plausible turned up, ask what
starts the app. If you cannot ask (no one is there, because the question tool is
not available or returns an error), take the most specific candidate, and say in your final
report which one you took and why.

**Never read a value out of any `.env` file.** If a port, a URL or a key is
only in a `.env`, ask the person for it. Do not open the file.

## 2. Whether it signs in

Look for sign-in routes, a login component, a redirect on `/` in the router.
Step 5 below will show it for certain (`inspect /` of an app behind a
sign-in lists a login form), so this is a first look, not the verdict.

If it does sign in, the person chooses how. Ask once:

- **`versioncam login`**: a browser opens, they sign in the way they always
  do, and the recorder saves the session to a file that stays out of git. It
  is the right default when a person is there. Config: `auth: { storageState:
  ".versioncam/auth.json" }`, and they run `npx versioncam login` themselves;
  you cannot, because it waits for them.
- **A `login` hook** that reads named variables from `.env.recording`. It is
  the right one for CI. You write the hook with the variable *names*
  (`process.env.RECORDING_USER`, say); they put the values in
  `.env.recording`, which is gitignored.

Never write a secret anywhere (not into the config, not into a clip, not into
your report), and never go looking for one. With no one to ask, stop here and
say what the person needs to do, because nothing below works on a sign-in
screen.

## 3. Write the config

Write `versioncam.config.ts` in the app's directory, with only what the app
needs:

```ts
import { defineRecorder } from "versioncam";

export default defineRecorder({
  baseUrl: "http://localhost:5173",
  webServer: { command: "npm run dev", url: "http://localhost:5173" },
  viewport: { width: 1440, height: 900 },
  clips: "demos/clips/**/*.clip.ts",
});
```

Add `auth` if step 2 said so, and `cursorStart` if step 7 says so. Do not add
`settle`, `review` or `theme`. Every default is there because it is right for
most apps, and a field nobody needed is a question the next person has to
answer. In a comment above each field you did write, say why it has the value
it has, for example: the port came from the dev script, the command from the
README.

Then create `demos/clips/` in the app's directory, and make sure
`.versioncam/` is ignored, because recordings, renders and a saved sign-in go
there. If a `.gitignore` in the app's directory, or in a directory above it up
to the repository root, already ignores it, leave it. Otherwise add the line
to the nearest one (create one in the app's directory if there is none), and
leave the rest of the file alone.

## 4. `npx versioncam doctor`

It checks the machine, loads the config, and starts the app through
`webServer` exactly as every later command will, then stops it. **It must
pass.** If the app check fails, the reason is in its last lines and in
`.versioncam/webserver.log`: the wrong command, the wrong port, a port already
taken. Fix the config and run it again. Do not go on until it passes.

## 5. `npx versioncam inspect /`

It shows what is on the start page, as a clip will see it. Look for three
things:

- **A sign-in form.** Step 2 was wrong; go back to it.
- **A loading screen, or a warning that a settle timed out.** The app needs
  `settle.ready`: a function that says when the page is really done. Find what
  "loaded" means here (a map's `loaded()`, a canvas that has drawn, a
  spinner's test id gone), add it to the config, and inspect again.
- **An empty page.** The app may need a path other than `/`, or data it does
  not have. Say so.

## 6. Stability

Write `demos/clips/00-open.clip.ts`. It opens the start page, shows one
caption, and holds for three seconds:

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

It records the clip twice and compares every frame. `stable` means you can
go on. `unstable` prints the first frame that differs and saves the two
pictures behind it. **Read both** and say what differs.

What you may fix, in the config:

- A dev server's own tools, drawn over the app on their own clock, so the two
  pictures differ at frame 0. The recorder hides the tools of Next, Nuxt and
  Astro by itself, so what you see is something else: a debug toolbar, a query
  inspector. Say what you saw, and turn it off in its own config. That config
  is part of the app, so the person has to agree to the change. It is the one
  change to the app this phase may ask for.
- Something still animating in when the clip starts, such as a fade or a
  skeleton screen: add a `settle.ready` that waits for it to finish.
- Time rendered by the server rather than the page. The page's own clock is
  already fixed (`clock.time`), so a timestamp that still moves came from an
  API, and the next item covers that.

- **Live data**: a feed, a count that changes, a map's tiles, a model's
  answer. When the two pictures differ where the app fetched something, name
  the requests in the config's `replay.record` (a URL glob each, as the
  README's *Live data* shows) and run `stability` again. The first run
  records the answers into `replay/`, and every run after that serves them. A
  stream the page reads over time also goes in `replay.pace`. Say which
  requests you named and why. The replay holds the server's answers from the
  day it was recorded. Tell the person it belongs in the repository, and
  that it may contain whatever those answers contained.

**Never author on an unstable app without saying so.** Say it in the report
now, and in `summary.json` at the end, as `"stable": false`. A clip written
against an app that does not reproduce will fail CI, and whoever reads the
failure deserves to know that you knew.

## 7. The first frame

```bash
npx versioncam record --draft 00-open
npx versioncam frame 00-open 0
```

Look at where the cursor is. Every clip starts with the cursor there, and
frame 0 is taken before a clip's first line runs, so no clip can move it. The
default, `(0.72, 0.28)` of the viewport, was picked for one app's open map,
and in other apps it lands on a list row or a field. A reviewer fails a clip
whose first frame has the cursor on a control, a row or a field. If it is on one, set
`cursorStart` in the config to open space (a margin, the gap below a panel)
as fractions of the viewport, with a comment saying what is there, and look
at frame 0 again.

## 8. Report

Before you go on to the clip, report in a few lines:

- what you found (the command, the port, and where each came from);
- what you asked, and what the answer was, or what you assumed and why;
- that `stability` passed on `00-open`, or what differed;
- the files you created or changed (the config, `demos/clips/00-open.clip.ts`,
  `.gitignore`), and that **you committed nothing**, because reviewing and
  committing them is the person's job.

Then go back to the skill and continue with the clip.
