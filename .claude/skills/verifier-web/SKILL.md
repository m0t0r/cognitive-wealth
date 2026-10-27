---
name: verifier-web
description: Verify a change that reaches `apps/web` (a page, flow, component, or a package it renders) in the running production build, with agent-browser and a perf trace (`cw verify trace`). Use before reporting web or UI work as done, and when `/verify` or a PR needs runtime evidence.
---

# Verifying a web change

The evidence is what the running production build shows: agent-browser output, screenshots, and perf trace numbers. Every artifact goes under `.dev/` (gitignored). Run everything from the repo root.

## 1. Start the app

```sh
pnpm cw verify start               # the working tree
pnpm cw verify start --ref dev     # another ref ("before"), on the checkout's other port
```

Options, output and refusal codes come from `pnpm cw verify start --help`. The output's `url` is `$APP` for the rest of this skill. Its `households` hold the Households' `publicId`s, which are new on every run, so build URLs from the latest output. `database` and `passwordFile` let a CLI or a query reach the data. `owner@` signs in to Larkspur, the world's Firm.

What `--help` doesn't say:

- **Isolated services.** It runs against `compose.verify.yaml`, a separate Compose project (`cognitive-wealth-verify`) that keeps everything in memory: Postgres on `:5433`, Redis on `:6380`, Mailpit on `:8026`. Verification never uses the dev stack's database, Redis or Mailpit.
- **Fresh data each run.** Every run gives its server a new database, `verify_<token>_head` (or `_ref`), where the token is the worktree's and `main` in the main checkout. The served checkout's own migrations go in first, then the seed and the custodian's example Deliveries (`apps/custodian/fixtures/feed/`). The working tree's database is seeded through `cw`'s own calls. A `--ref` runs its own `pnpm cw … --json`, since its schema is the ref's. A ref from before `cw` (2026-10-26) gets its old `pnpm db:seed` and no Deliveries, and the output's `notes` say so. Each run also gets its own Redis key prefix, so rate limits reset.
- **Ports.** Each checkout has its own port pair: the main checkout's is `:3100` and `:3101`, and a worktree's comes from its id, somewhere in 3102–3899, the same on every run. Runs from different worktrees never touch each other's server, database or `--ref` checkout. A port held by anything but this checkout's own server is refused (`port_taken`) before anything changes.
- **The change's own data.** When the world file lacks what the change shows, pass `--seed <file>:<export>` with the e2e helper that seeds it, e.g. `--seed apps/web-e2e/support/households.ts:seedHouseholdOfGrace`. Pass the same `--seed` to the `--ref` run. It always comes from the working tree, so a helper that writes a table or column the ref lacks fails there. Write the helper in `apps/web-e2e/support/`, where the e2e test uses it too, never as raw SQL.
- **Build.** It runs `turbo build --filter=web` and serves the standalone server with `NODE_ENV=production`, the same artifact the Docker image and e2e run. Turbo's cache answers an unchanged build in seconds; a `--ref`'s first build, in `.dev/worktrees/<token>-<sha>`, takes about 20 s. Don't run it while `pnpm e2e` runs in the same checkout: both build into `apps/web/.next`. Two builds at once fail fast ("Another next build process is already running"), but a build while e2e's tests run replaces the standalone server under its workers. Verify after e2e finishes, or verify first and then run `pnpm e2e --filter=web-e2e --only` on the same build (#180).
- **Rerun after every edit.** Each run replaces this checkout's own server for the same role, and nothing else.

Use the Docker build only when one of these holds:

- the change touches what only the images exercise: `apps/web/Dockerfile`, `apps/custodian/Dockerfile`, `compose*.yaml`, `docker/`, `next.config.ts` output or file tracing, or how env and secrets reach the server;
- you're taking the final evidence for a major feature's PR;
- the user asks for it.

Run it with `pnpm cw verify compose up [<service> ...]` and `pnpm cw verify compose down`, never a plain `docker compose up`, which starts the dev stack's project (`cognitive-wealth`) and its volumes. Its project is the checkout's own (`cw-compose-<token>`), with host ports offset from the checkout's pair; a worktree gets throwaway secrets in its own `.secrets/`. Whenever `db` runs, `up` gives it the same data as `verify start`'s servers. Sign in with `pnpm cw dev sign-in <email> --app <urls.web> --mailpit <urls.mailpit>`. Use `docker compose -p <project> ps|logs|exec` for anything else. A worktree's teardown removes the project with its volumes.

## 2. Sign in and open the browser

One persona per client IP:

```sh
pnpm cw dev sign-in owner@cognitive-wealth.test --app $APP --ip 10.77.0.1 --mailpit http://127.0.0.1:8026
pnpm cw verify browser start owner@cognitive-wealth.test --app $APP --ip 10.77.0.1
```

`verify start`'s output names both commands with `$APP` filled in. `browser start` opens `$APP` signed in, in this checkout's agent-browser session, in a headless Chrome the session launches for itself, and sets the window to 1280×800, the size `cw verify trace` measures at. The output's `session` is `$SESSION` for the rest of this skill. Each worktree's session has its own Chrome, so verifications in several worktrees run at once without waiting for each other.

A second persona gets its own `dev sign-in --ip 10.77.0.2` and a plain session of its own, opened once with `agent-browser --session <name> --state … --headers … open <url>` and driven afterwards with `--session <name>` alone, as docs/dev-sign-in.md shows.

## 3. Drive the change

Every agent-browser call takes `--session $SESSION`. Re-run `snapshot -i` after any DOM change, because refs go stale. At each state you reach, capture `screenshot <absolute path>`, `errors`, `console`, and `a11y` for routes the change touches.

Choose the depth by the size of the change:

- **Minor** (one component, copy, styling, one state of an existing page): go to the route, snapshot, interact, and screenshot before and after. Check light and dark themes when you changed styling. Then probe around the change: empty and oversized input, keyboard only (Tab, Enter, Escape, focus return), a narrow viewport (`set viewport 375 812`, then `set viewport 1280 800` to restore it), and double-submit.
- **Major** (a new route or multi-step flow, a change spanning several pages, auth, invitations, roles or tenant switching): run `agent-browser skills get dogfood` and follow it, scoped to the feature. Use the `$SESSION` session that's already signed in and skip its password login step. Write the report to `.dev/dogfood/<branch>/` instead of `./dogfood-output/`. Cover every role the feature treats differently, with one persona and one IP each.

## 4. Perf trace

Do this for every change that renders. Run it on each route the change touches, after `agent-browser --session $SESSION open <url>`:

1. `pnpm cw verify trace <route>` traces a page load of the session's current page and returns its LCP (with subparts), CLS and DevTools' insights. It records what the chrome-devtools MCP recorded, the same way (DevTools' own trace categories; the page, `about:blank`, the trace started, the page loaded, 5 s), in a headless Chrome of its own signed in with the session's cookies, and reads it with DevTools' own trace engine. Its `browserApi` is the page's own LCP and layout-shift entries for the same load: they match `summary.lcp` (within the API's ~4 ms rounding) and `summary.cls`, and a mismatch is a bug to report, not a number to use. The trace is saved as `.dev/perf/<route>.trace.json.gz`, which DevTools' Performance panel opens.
2. When the change adds or alters an interaction, take a snapshot, then `pnpm cw verify trace <route>-<what> --step "click @e3" [--step "…"]`: it runs those agent-browser commands while recording, without reloading, and returns INP.
3. Compare the numbers with these budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms. Record every insight whose `state` is `fail` or `informative`, with its `description` and `savings`. Put the numbers in the report even when they're within budget, so later runs have a baseline.

One trace is one sample. A number near a budget, or a before/after comparison, needs at least three runs of each, reported as their median and range.

A trace that lacks what a number needs is refused with a code, never reported as 0: `incomplete_trace` (no layout-shift or LCP events were recorded), `no_navigation`, `no_lcp`, `no_interaction` (the steps produced nothing Chrome times as an interaction: use a click, tap or key press), `wrong_viewport` (the window isn't 1280×800: CLS is a share of the window, so a number at any other size can't be compared; run the `set viewport` the message names), `throttle_not_applied` (see the throttling gotcha), `trace_timeout` (a step Chrome never finished, named in the message).

## 5. Clean up

```sh
pnpm cw verify browser stop   # closes this checkout's session and its Chrome
pnpm cw verify stop           # stops this checkout's servers and removes its --ref checkouts
```

Both act only on what their own checkout started, with the same code a worktree's teardown runs; other worktrees' servers, checkouts and sessions stay. What they found and did, `--dry-run` and a failure's `code` come from `pnpm cw verify --help`. A worktree removed without them is cleaned up by its teardown.

The verify Compose project can keep running between tasks. `docker compose -f compose.yaml -f compose.verify.yaml down` throws all its data away.

## Gotchas

- Don't launch agent-browser with `--args "--remote-debugging-port=…"`: its daemon hangs and keeps relaunching Chrome, and only `kill -9` on the `agent-browser-darwin-arm64` daemon stops it. `cw verify trace` reaches the session's Chrome through `agent-browser get cdp-url` instead.
- Don't use `agent-browser vitals`, `agent-browser trace` or `agent-browser profiler` (with its default categories) as evidence: in #144's tests `vitals` missed a 250 ms interaction, `trace` records no INP, and `profiler`'s defaults record no layout shifts, so CLS reads 0.
- `screenshot .dev/x.png` reads the path as a CSS selector and saves the image to a temporary directory. Pass an absolute path.
- At phone width, `screenshot --full` can crop the right edge by the scrollbar's width (about 15 px), so a page that fits looks clipped. Judge overflow from a plain viewport screenshot, or measure: `document.documentElement.scrollWidth` greater than `clientWidth` is real overflow.
- `dev sign-in` reads Mailpit at `--mailpit`, then `MAILPIT_URL`, which defaults to the dev stack's `:8025`. Without `--mailpit http://127.0.0.1:8026` it waits for an email that never arrives. Every server, from every worktree, has the same seeded users and shares one Mailpit, so sign in one persona at a time.
- `dev:sign-in` saves `.dev/auth/<email>.json` in the checkout it runs from, and `verify browser start` loads that one first, falling back to the main checkout's. Each server has its own database, so a session works only on the server it signed in to: signing the same email in to the `--ref` server after the working tree's replaces the file, so load the working tree's session before that, or save the other with `--state`.
- `--state` on a session that's already running leaves it on `about:blank` without an error: the `open` before it printed the right title, and now `snapshot` says "(empty page)" (#225). Pass `--state` and `--headers` only on the `open` that starts a session, never through a wrapper that adds them to every call, and `close` the session before loading another state.
- Rate limits reset on every `verify start`, because each run gets a new Redis prefix. Within a run, give each persona its own `--ip`.
- The traces run with no CPU or network throttling on a fast Mac, so the numbers are optimistic. For a change where performance matters, trace again with `--throttle` (4× CPU and Slow 4G, held for that trace only). Chrome doesn't always apply CPU throttling: the chrome-devtools MCP's "4x CPU" traces did exactly the unthrottled amount of work, so throttled numbers from before #144 are network-only. `cw verify trace` times a fixed piece of work in the page before and after, returns the slowdown as `cpuSlowdown` (about 4), and refuses under 3 as `throttle_not_applied`.
- With CPU throttling on, Chrome sometimes stalls a traced load for good (Chrome 147: 4 in 10). A page-load trace then retries in a fresh Chrome, up to 3 (`attempts` says how many); an interaction trace is refused as `trace_timeout`, so run it again.
- A page-load trace runs in a fresh Chrome after one untraced load: the HTTP cache is warm, V8's code cache isn't. Unthrottled, that barely moves LCP; throttled, it reads above what a long-lived browser would (on the Household overview, about 800 ms against 650 ms network-only). Compare throttled numbers only with other `cw verify trace` ones.
- The `LegacyJavaScript` insight flags every page for about 14 kB: it's Next.js's own polyfill module (1.4 kB, each polyfill guarded, so nothing runs on current Chrome), and the 14 kB is DevTools' estimate. Not something to fix. `RenderBlocking` failing with `LCP: 0` savings is Next.js's CSS, likewise.
