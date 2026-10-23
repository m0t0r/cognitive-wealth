#!/usr/bin/env node
// Inspects a published PR body in light and dark mode with agent-browser: reports every image in
// the body that didn't load and saves a full-page screenshot per theme to read back.
//
//   node inspect.mjs <pr> --out <dir>
//
// It's a script so step 8 runs in a worktree session, where Claude Code's isolation refuses an
// inline `agent-browser eval "…"` and any command naming a github.com URL.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" } },
});
const [pr] = positionals;
if (!pr || !values.out) throw new Error("usage: inspect.mjs <pr> --out <dir>");

const url = execFileSync("gh", ["pr", "view", pr, "--json", "url", "--jq", ".url"], {
  encoding: "utf8",
}).trim();
const session = `pr-inspect-${pr}`;
const browser = (...args) =>
  execFileSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

// The body is the first .markdown-body on the page. Its images are lazy, and the other theme's
// copy is display:none, so load them all eagerly before reading naturalWidth.
const CHECK = `(async () => {
  const body = document.querySelector(".markdown-body");
  const images = body ? [...body.querySelectorAll("img")] : [];
  for (const image of images) image.loading = "eager";
  await Promise.all(images.map((image) => image.complete ? null : new Promise((done) => {
    image.addEventListener("load", done);
    image.addEventListener("error", done);
    setTimeout(done, 15000);
  })));
  return {
    body: Boolean(body),
    images: images.length,
    broken: images.filter((image) => !image.naturalWidth).map((image) => image.src),
  };
})()`;

mkdirSync(values.out, { recursive: true });
const themes = {};
try {
  for (const theme of ["light", "dark"]) {
    browser("set", "media", theme);
    browser("open", url);
    const raw = JSON.parse(browser("--json", "eval", CHECK));
    const result = raw.data?.result ?? raw.data ?? raw;
    // Absolute, since the agent-browser daemon doesn't share this process's working directory.
    const screenshot = resolve(values.out, `pr-${pr}.${theme}.png`);
    browser("screenshot", "--full", screenshot);
    themes[theme] = { ...result, screenshot };
  }
} finally {
  browser("close");
}

const ok = Object.values(themes).every((t) => t.body && t.broken.length === 0);
console.log(JSON.stringify({ ok, pr, url, themes }, null, 2));
process.exitCode = ok ? 0 : 1;
