---
name: verifier-web
description: Verify a change that reaches `apps/web` (a page, flow, component, or a package it renders) in the running production build, with agent-browser and a chrome-devtools perf trace. Use before reporting web or UI work as done, and when `/verify` or a PR needs runtime evidence.
---

# Verifying a web change

The evidence is what the running production build shows: agent-browser output, screenshots, and perf trace numbers. Every artifact goes under `.dev/` (gitignored). Run everything from the repo root.

## 1. Start the app

```sh
.claude/skills/verifier-web/start-app.sh               # the working tree, on http://localhost:3100
.claude/skills/verifier-web/start-app.sh --ref dev     # another ref ("before"), on :3101
```

This is the default for every run. It runs the production build of `web` against **isolated** services. Verification never uses the dev stack's database, Redis or Mailpit.

- **Services.** It starts `compose.verify.yaml`, a separate Compose project (`cognitive-wealth-verify`) that keeps everything in memory: Postgres on `:5433`, Redis on `:6380`, Mailpit on `:8026`.
- **Fresh data each run.** Every run gives its server a new database, `verify_<port>`, cloned from the empty template. That ref's own migrations and the seed are applied to it, and the server gets its own Redis key prefix. Each run starts from the seeded state and nothing carries over between runs.
- **Build.** It runs `turbo build --filter=web` and serves the standalone server with `NODE_ENV=production`, the same artifact the Docker image and e2e run. An unchanged build comes from Turbo's cache, so the whole script takes about 3 s.
- **`--ref`.** It builds that ref in `.dev/worktrees/<sha>`; the first build there takes about 20 s.
- **Rerun after every edit.** Each run replaces the server it started on the same port.

Use the Docker build (`docker compose -f compose.yaml -f compose.dev.yaml up --build -d`, app at `http://localhost:3000`) only when one of these holds:

- the change touches what only the image exercises: `apps/web/Dockerfile`, `compose*.yaml`, `docker/`, `next.config.ts` output or file tracing, or how env and secrets reach the server;
- you're taking the final evidence for a major feature's PR;
- the user asks for it.

That stack runs on the dev database, so stage its data with `pnpm org:create` and never wipe its volume. The seeded users are listed in [docs/dev-sign-in.md](../../../docs/dev-sign-in.md). The rest of this skill uses `$APP` for the app URL.

## 2. Sign in and start the shared browser

One persona per client IP:

```sh
MAILPIT_URL=http://127.0.0.1:8026 pnpm dev:sign-in owner@cognitive-wealth.test --app $APP --ip 10.77.0.1
.claude/skills/verifier-web/start-browser.sh owner@cognitive-wealth.test $APP 10.77.0.1
```

The chrome-devtools MCP never launches a browser. It attaches to whatever is listening on `127.0.0.1:9222` (`--browserUrl`), so the script puts agent-browser's own Chrome for Testing there. It starts that Chrome headless with a throwaway profile, connects agent-browser session `verify` to it, and loads the session cookies, which puts the perf trace in step 4 on the signed-in page. If anything else holds 9222, often an everyday Chrome with remote debugging turned on, the script exits instead of tracing in a personal browser. Ask the user to quit that process; don't kill it yourself. A second persona gets its own `dev:sign-in --ip 10.77.0.2` and a plain `agent-browser --session <name> --state … --headers …` session, as shown in docs/dev-sign-in.md.

## 3. Drive the change

Every agent-browser call takes `--session verify`. Re-run `snapshot -i` after any DOM change, because refs go stale. At each state you reach, capture `screenshot <absolute path>`, `errors`, `console`, and `a11y` for routes the change touches.

Choose the depth by the size of the change:

- **Minor** (one component, copy, styling, one state of an existing page): go to the route, snapshot, interact, and screenshot before and after. Check light and dark themes when you changed styling. Then probe around the change: empty and oversized input, keyboard only (Tab, Enter, Escape, focus return), a narrow viewport (`viewport 375 812`), and double-submit.
- **Major** (a new route or multi-step flow, a change spanning several pages, auth, invitations, roles or tenant switching): run `agent-browser skills get dogfood` and follow it, scoped to the feature. Use the `verify` session that's already signed in and skip its password login step. Write the report to `.dev/dogfood/<branch>/` instead of `./dogfood-output/`. Cover every role the feature treats differently, with one persona and one IP each.

## 4. Perf trace

Do this for every change that renders. Run it on each route the change touches, after `agent-browser --session verify open <url>`:

1. `list_pages` (page ids change whenever the browser restarts), then `performance_start_trace` with `reload: true`, `autoStop: true`, `filePath: <repo>/.dev/perf/<route>.trace.json.gz`. This records LCP and CLS for a page load.
2. When the change adds or alters an interaction, also run `performance_start_trace` with `reload: false` and `autoStop: false`. Drive the interaction with agent-browser, then call `performance_stop_trace` with a `filePath`. This records INP.
3. Compare the numbers with these budgets: LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms. For every insight with estimated savings, call `performance_analyze_insight` and record what it says. Put the numbers in the report even when they're within budget, so later runs have a baseline.

## 5. Clean up

```sh
.claude/skills/verifier-web/stop-browser.sh   # closes the session and stops only the Chrome start-browser.sh started
for p in .dev/verify/server-*.pid; do kill "$(cat "$p")"; rm "$p"; done
git worktree remove --force .dev/worktrees/<sha>   # for each --ref you served
```

The verify Compose project can keep running between tasks. `docker compose -f compose.yaml -f compose.verify.yaml down` throws all its data away.

## Gotchas

- Don't launch agent-browser with `--args "--remote-debugging-port=9222"`: its daemon hangs and keeps relaunching Chrome, and only `kill -9` on the `agent-browser-darwin-arm64` daemon stops it. Use `start-browser.sh`, which starts Chrome first and connects to it.
- `screenshot .dev/x.png` reads the path as a CSS selector and saves the image to a temporary directory. Pass an absolute path.
- The MCP's `filePath` must be inside the repo (its workspace root). A path in `/tmp` or the scratchpad is refused.
- `dev:sign-in` reads Mailpit at `MAILPIT_URL`, which defaults to the dev stack's `:8025`. Without `MAILPIT_URL=http://127.0.0.1:8026` it waits for an email that never arrives. Both servers (`:3100` and `:3101`) have the same seeded users and share one Mailpit, so sign in one persona at a time.
- `dev:sign-in` saves `.dev/auth/<email>.json` in the checkout it runs from, and `start-browser.sh` loads that one first, falling back to the main checkout's. Each server has its own database, so a session works only on the server it signed in to: signing the same email in to `:3101` after `:3100` replaces the file, so load the `:3100` session before that, or save the other with `--state`.
- Rate limits reset on every `start-app.sh` run, because each run gets a new Redis prefix. Within a run, give each persona its own `--ip`.
- The traces run with no CPU or network throttling on a fast Mac, so the numbers are optimistic. For a change where performance matters, trace again after calling `emulate` with `cpuThrottlingRate: 4` and `networkConditions: "Slow 4G"`. Then call `emulate` with neither set to turn throttling off.
