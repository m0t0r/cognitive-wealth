#!/usr/bin/env node
// Renders every *.mmd in a directory with the `pele` skill, twice: <name>.light.svg and
// <name>.dark.svg, themed with the design system's own tokens (packages/design-system globals.css),
// so a PR's diagrams match the app and follow GitHub's theme through <picture>.
//
//   node render.mjs <dir> [name ...] [--svg-only]
//
// Then rasterizes each SVG to a 2x PNG with agent-browser, because GitHub's attachments take PNG.
// `--svg-only` stops at the SVGs: docs/diagrams (`pnpm docs:diagrams`) commits those and no PNGs.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const svgOnly = args.includes("--svg-only");
const [dirArg, ...only] = args.filter((a) => a !== "--svg-only");
if (!dirArg) throw new Error("usage: render.mjs <dir> [name ...] [--svg-only]");
const dir = resolve(dirArg);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const peleRender = join(root, ".claude/skills/pele/scripts/render.mjs");

// ---- Design tokens → pele variables --------------------------------------------------------

function oklchToHex(value) {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%?)?\s*\)/);
  if (!m) throw new Error(`Not an oklch() colour: ${value}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (value.includes("%") ? 100 : 1);
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const channels = linear.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  if (alpha < 1) channels.push(Math.round(alpha * 255));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function tokens(selector) {
  const css = readFileSync(join(root, "packages/design-system/src/styles/globals.css"), "utf8");
  const block = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1];
  if (!block) throw new Error(`No ${selector} block in globals.css`);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)].map(([, k, v]) => [k, oklchToHex(v)]));
}

function theme(t) {
  return {
    "--pele-bg": t.card,
    "--pele-fg": t.foreground,
    "--pele-muted": t["muted-foreground"],
    "--pele-line": t["muted-foreground"],
    "--pele-surface": t.muted,
    "--pele-surface-alt": t.accent ?? t.muted,
    "--pele-border": t.border,
    "--pele-accent": t.primary,
    "--pele-font": "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    "--pele-radius": "10px",
    // Series lead with the brand primary, then the design system's chart ramp.
    "--pele-series-1": t.primary,
    "--pele-series-2": t["chart-2"],
    "--pele-series-3": t["chart-4"],
    "--pele-series-4": t["chart-1"],
    "--pele-series-5": t["chart-3"],
    "--pele-series-6": t["chart-5"],
  };
}

const THEMES = { light: theme(tokens(":root")), dark: theme(tokens(".dark")) };

// Pele's root <svg> carries a style attribute whose --_x vars read --pele-* with fallbacks, so
// declaring --pele-* first on that same attribute themes the whole diagram.
function themed(svg, vars) {
  const decls = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
  const out = svg.replace(/(<svg\b[^>]*?\bstyle=")/, `$1${decls};`);
  if (out === svg) throw new Error("No style attribute on the root <svg>");
  // An <img> shows the SVG on its own, so paint the background the vars describe.
  return out.replace(/(<svg\b[^>]*>)/, `$1<rect width="100%" height="100%" rx="10" fill="${vars["--pele-bg"]}"/>`);
}

// ---- Render --------------------------------------------------------------------------------

const names = (only.length ? only : readdirSync(dir).filter((f) => f.endsWith(".mmd")).map((f) => basename(f, ".mmd")));
const receipts = [];
for (const name of names) {
  const base = join(dir, `${name}.base.svg`);
  const run = spawnSync(process.execPath, [peleRender, join(dir, `${name}.mmd`), base], { encoding: "utf8" });
  const receipt = JSON.parse(run.stderr.trim().split("\n").at(-1));
  if (!receipt.ok) {
    console.error(JSON.stringify({ name, ...receipt }));
    process.exitCode = 1;
    continue;
  }
  const svg = readFileSync(base, "utf8");
  for (const [mode, vars] of Object.entries(THEMES)) writeFileSync(join(dir, `${name}.${mode}.svg`), themed(svg, vars));
  if (svgOnly) rmSync(base);
  receipts.push({ name, type: receipt.type, width: receipt.width, height: receipt.height });
}
if (svgOnly) {
  console.log(JSON.stringify({ ok: process.exitCode !== 1, dir, rendered: receipts }));
  process.exit();
}

// ---- Rasterize -----------------------------------------------------------------------------

// One throwaway agent-browser session; each SVG is opened as its own page at 2x and clipped to
// the SVG element, so the PNG is exactly the diagram.
const session = `pr-visual-${process.pid}`;
const ab = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  for (const { name, width, height } of receipts) {
    for (const mode of Object.keys(THEMES)) {
      const svgPath = join(dir, `${name}.${mode}.svg`);
      ab("set", "viewport", String(Math.ceil(width) + 16), String(Math.ceil(height) + 16), "2");
      ab("open", `file://${svgPath}`);
      ab("screenshot", "svg", join(dir, `${name}.${mode}.png`));
    }
  }
} finally {
  try {
    ab("close");
  } catch {
    // Already closed.
  }
}

console.log(JSON.stringify({ ok: process.exitCode !== 1, dir, rendered: receipts }));
