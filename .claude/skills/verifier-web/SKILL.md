---
name: verifier-web
description: Verify a change that reaches `apps/web` (a page, flow, component, or a package it renders) in the running production build, with agent-browser and a chrome-devtools perf trace. Use before reporting web or UI work as done, and when `/verify` or a PR needs runtime evidence.
---

# Verifying a web change

The evidence is what the running production build shows: agent-browser output, screenshots, and perf trace numbers. Every artifact goes under `.dev/` (gitignored). Run everything from the repo root.

## 1. Start the app

```sh
.claude/skills/verifier-web/start-app.sh               # the working tree; prints its URL
.claude/skills/verifier-web/start-app.sh --ref dev     # another ref ("before"), on the next port
```

Each checkout has its own port pair: the main checkout's is `:3100` and `:3101`, and a worktree's comes from its id, somewhere in 3102–3899, the same on every run. Use the URL the script prints as `$APP`. Runs from different worktrees, at the same time or not, never touch each other's server, database or `--ref` checkout.

This is the default for every run. It runs the production build of `web` against **isolated** services. Verification never uses the dev stack's database, Redis or Mailpit.

- **Services.** It starts `compose.verify.yaml`, a separate Compose project (`cognitive-wealth-verify`) that keeps everything in memory: Postgres on `:5433`, Redis on `:6380`, Mailpit on `:8026`.
- **Fresh data each run.** Every run gives its server a new database, `verify_<token>_head` (or `_ref`, where the token is the worktree's and `main` in the main checkout), cloned from the empty template. That ref's own migrations and the seed are applied to it, then the custodian's example Deliveries (`apps/custodian/fixtures/feed/`, through `custodian:ingest`) into Larkspur, so pages that show Positions have data. The server gets its own Redis key prefix. Each run starts from that state and nothing carries over between runs.
- **The change's own data.** When the world file doesn't have what the change shows, pass `--seed <file>:<export>` with the e2e helper that seeds it, e.g. `--seed apps/web-e2e/support/households.ts:seedHouseholdOfGrace`. It runs after the world and the Deliveries, through `packages/db/src/cli/run-seed.ts`, and prints what the helper returns (here the new Household's `publicId`). Pass the same `--seed` to the `--ref` run, so before and after have the same data: it always comes from the working tree, so a helper that writes a table or column the ref doesn't have fails there. Write the helper in `apps/web-e2e/support/`, where the e2e test uses it too, never as raw SQL.
- **What it prints.** On stderr, the run's `DATABASE_URL` and password file (for a CLI pointed at it, or a query) and a file of the Households' names and `publicId`s, `households-<head|ref>.tsv` in the state directory below, to build URLs from; ids change every run. The URL is stdout's last line. `owner@` signs in to Larkspur, the world's Firm.
- **Build.** It runs `turbo build --filter=web` and serves the standalone server with `NODE_ENV=production`, the same artifact the Docker image and e2e run. An unchanged build comes from Turbo's cache, so the whole script takes about 3 s. Don't run it while `pnpm e2e` runs in the same checkout: both build into `apps/web/.next` and serve `.next/standalone`. Two builds at once fail fast (Next locks `.next/lock` and the second exits with "Another next build process is already running"), but a build while e2e's tests run replaces the standalone server under its workers. Start verification after e2e finishes, or verify first and then run `pnpm e2e --filter=web-e2e --only` on the same build (#180).
- **`--ref`.** It builds that ref in the main checkout's `.dev/worktrees/<token>-<sha>`; the first build there takes about 20 s.
- **Rerun after every edit.** Each run replaces the server this checkout started for the same role (working tree or `--ref`), and nothing else.
- **A taken port is refused before anything changes.** If anything but this checkout's own server listens on the port (another worktree whose pair happens to be the same, or any other process), the script exits without dropping a database or stopping a process. Pass `--port` with a free one.
- **State.** Pidfiles and server logs go to the main checkout's `.dev/verify/<token>/`, so removing a worktree (its teardown, `pnpm dev:prune`) still finds its server, databases and `--ref` checkouts and removes them.

Use the Docker build only when one of these holds:

- the change touches what only the images exercise: `apps/web/Dockerfile`, `apps/custodian/Dockerfile`, `compose*.yaml`, `docker/`, `next.config.ts` output or file tracing, or how env and secrets reach the server;
- you're taking the final evidence for a major feature's PR;
- the user asks for it.

Run it with `compose.sh`, never a plain `docker compose up`, which is the dev stack's project (`cognitive-wealth`) and its volumes:

```sh
.claude/skills/verifier-web/compose.sh up                # every service in compose.yaml; or name some: up custodian
.claude/skills/verifier-web/compose.sh ps                # any other docker compose command: logs, exec, ...
.claude/skills/verifier-web/compose.sh down              # stops it and deletes its volumes
```

It builds the checkout's own `compose.yaml` into a project of its own, `cw-compose-<token>`, with fresh volumes and host ports offset from the checkout's port pair (it prints the web, custodian and Mailpit URLs; the main checkout's are `:4100`, `:5100` and `:6100`). A worktree has no `.secrets/`, so it gets throwaway ones in its own. Whenever `db` runs, `up` gives it the same data as `start-app.sh`'s servers: it publishes the project's own Postgres on a loopback port of the checkout's own (`compose.db.yaml`; the main checkout's is `:7100`), then migrates, seeds and ingests the example Deliveries from the host, so the seeded users in [docs/dev-sign-in.md](../../../docs/dev-sign-in.md) sign in (`owner@` to Larkspur) with `MAILPIT_URL=<its Mailpit> pnpm dev:sign-in <email> --app <its web URL>`. It prints what the seed added and each Delivery's `status` (`ingested`, or `already_ingested` on a later `up`), read from `cw`'s `--json`, and a failure as `cw <code>: <message>`; then the database URL and password file for a CLI pointed at it. A second `up` keeps the data, since the seed and Ingestion skip what's there; `down` starts it over. A worktree's teardown removes the project with its volumes, so a forgotten `down` doesn't outlive the worktree. The rest of this skill uses `$APP` for the app URL.

## 2. Sign in and start the shared browser

One persona per client IP:

```sh
MAILPIT_URL=http://127.0.0.1:8026 pnpm dev:sign-in owner@cognitive-wealth.test --app $APP --ip 10.77.0.1
.claude/skills/verifier-web/start-browser.sh owner@cognitive-wealth.test $APP 10.77.0.1
```

The chrome-devtools MCP never launches a browser. It attaches to whatever is listening on `127.0.0.1:9222` (`--browserUrl`), so the script puts agent-browser's own Chrome for Testing there. It starts that Chrome headless with a throwaway profile, connects this checkout's agent-browser session to it, and loads the session cookies, which puts the perf trace in step 4 on the signed-in page. The session is `verify` in the main checkout and `verify-<token>` in a worktree; the script prints it as its last line, and the rest of this skill calls it `$SESSION`. If anything else holds 9222, often an everyday Chrome with remote debugging turned on, the script exits instead of tracing in a personal browser. Ask the user to quit that process; don't kill it yourself.

There is one such Chrome for every worktree, and one worktree at a time holds it: sessions connected to one Chrome drive the same tab with the same cookies, and Chrome runs one trace at a time. The script records the holder in the main checkout's `.dev/verify/chrome.owner`. While another live worktree holds it, the script exits and names that worktree; wait for it to finish (its `stop-browser.sh` frees the Chrome) or ask the user. Once the holder's worktree is gone, or its Chrome has died, the next run takes over with a fresh Chrome. A second persona gets its own `dev:sign-in --ip 10.77.0.2` and a plain `agent-browser --session <name> --state … --headers …` session, as shown in docs/dev-sign-in.md.

## 3. Drive the change

Every agent-browser call takes `--session $SESSION`. Re-run `snapshot -i` after any DOM change, because refs go stale. At each state you reach, capture `screenshot <absolute path>`, `errors`, `console`, and `a11y` for routes the change touches.

Choose the depth by the size of the change:

- **Minor** (one component, copy, styling, one state of an existing page): go to the route, snapshot, interact, and screenshot before and after. Check light and dark themes when you changed styling. Then probe around the change: empty and oversized input, keyboard only (Tab, Enter, Escape, focus return), a narrow viewport (`set viewport 375 812`, then `set viewport 1280 800` to restore it), and double-submit.
- **Major** (a new route or multi-step flow, a change spanning several pages, auth, invitations, roles or tenant switching): run `agent-browser skills get dogfood` and follow it, scoped to the feature. Use the `$SESSION` session that's already signed in and skip its password login step. Write the report to `.dev/dogfood/<branch>/` instead of `./dogfood-output/`. Cover every role the feature treats differently, with one persona and one IP each.

## 4. Perf trace

Do this for every change that renders. Run it on each route the change touches, after `agent-browser --session $SESSION open <url>`:

1. `list_pages` (page ids change whenever the browser restarts), then `performance_start_trace` with `reload: true`, `autoStop: true`, `filePath: <repo>/.dev/perf/<route>.trace.json.gz`. This records LCP and CLS for a page load.
2. When the change adds or alters an interaction, also run `performance_start_trace` with `reload: false` and `autoStop: false`. Drive the interaction with agent-browser, then call `performance_stop_trace` with a `filePath`. This records INP.
3. Compare the numbers with these budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms. For every insight with estimated savings, call `performance_analyze_insight` and record what it says. Put the numbers in the report even when they're within budget, so later runs have a baseline.

## 5. Clean up

```sh
.claude/skills/verifier-web/stop-browser.sh   # closes this checkout's session; stops and frees the Chrome if this checkout holds it
.claude/skills/verifier-web/stop-app.sh       # stops this checkout's servers and removes its --ref checkouts
```

Both act only on what their own checkout started, found in the main checkout's `.dev/verify/<token>/`, `.dev/verify/chrome.*` and `.dev/worktrees/<token>-*`; other worktrees' servers, checkouts and Chrome stay. Run `stop-browser.sh` as soon as the browser work is done, so another worktree can take the Chrome. A worktree removed without them is cleaned up by its teardown.

The verify Compose project can keep running between tasks. `docker compose -f compose.yaml -f compose.verify.yaml down` throws all its data away.

## Gotchas

- Don't launch agent-browser with `--args "--remote-debugging-port=9222"`: its daemon hangs and keeps relaunching Chrome, and only `kill -9` on the `agent-browser-darwin-arm64` daemon stops it. Use `start-browser.sh`, which starts Chrome first and connects to it.
- `screenshot .dev/x.png` reads the path as a CSS selector and saves the image to a temporary directory. Pass an absolute path.
- At phone width, `screenshot --full` can crop the right edge by the scrollbar's width (about 15 px), so a page that fits looks clipped. Judge overflow from a plain viewport screenshot, or measure: `document.documentElement.scrollWidth` greater than `clientWidth` is real overflow.
- The MCP's `filePath` must be inside the repo (its workspace root). A path in `/tmp` or the scratchpad is refused.
- `dev:sign-in` reads Mailpit at `MAILPIT_URL`, which defaults to the dev stack's `:8025`. Without `MAILPIT_URL=http://127.0.0.1:8026` it waits for an email that never arrives. Every server, from every worktree, has the same seeded users and shares one Mailpit, so sign in one persona at a time.
- `dev:sign-in` saves `.dev/auth/<email>.json` in the checkout it runs from, and `start-browser.sh` loads that one first, falling back to the main checkout's. Each server has its own database, so a session works only on the server it signed in to: signing the same email in to the `--ref` server after the working tree's replaces the file, so load the working tree's session before that, or save the other with `--state`.
- Rate limits reset on every `start-app.sh` run, because each run gets a new Redis prefix. Within a run, give each persona its own `--ip`.
- The traces run with no CPU or network throttling on a fast Mac, so the numbers are optimistic. For a change where performance matters, trace again after calling `emulate` with `cpuThrottlingRate: 4` and `networkConditions: "Slow 4G"`. Then call `emulate` with neither set to turn throttling off.
