#!/usr/bin/env node
// Collects the mechanical facts of a change from git and writes them as facts.json plus Mermaid
// sources (*.mmd) for the data charts. Nothing here is inferred: every number comes from git.
//
//   node facts.mjs [--base <ref>] [--head <ref>] --out <dir>
//
// --base defaults to the merge base with origin/dev, --head to HEAD.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string", default: "HEAD" },
    out: { type: "string" },
  },
});
if (!values.out) throw new Error("--out <dir> is required");

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const head = values.head;
const base = values.base ?? git("merge-base", "origin/dev", head).trim();
const range = `${base}...${head}`;

// Churn that says nothing about the change: lockfiles and drizzle's generated snapshots.
const IGNORED = [
  /^pnpm-lock\.yaml$/,
  /(^|\/)uv\.lock$/,
  /^skills-lock\.json$/,
  /^packages\/db\/migrations\/meta\//,
];

function area(path) {
  const [top, name, third] = path.split("/");
  if ((top === "apps" || top === "packages") && name) return `${top}/${name}`;
  // Skills installed by `npx skills` live in .agents/skills; .claude/skills holds one per skill.
  if (top === ".agents" && name === "skills") return ".agents/skills (vendored)";
  if (top === ".claude" && name === "skills" && third) return `.claude/skills/${third}`;
  return path.includes("/") ? top : "(root)";
}

// pytest's default discovery: test_*.py or *_test.py.
const PYTEST = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;

function kind(path) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return "tests";
  // Python test packages also hold conftest.py fixtures and an empty __init__.py.
  if (PYTEST.test(path) || /(^|\/)tests\/(.*\/)?[^/]+\.py$/.test(path)) return "tests";
  if (path.startsWith("packages/db/migrations/")) return "migrations";
  // docs/ includes its diagrams' .mmd sources and rendered SVGs.
  if (/\.mdx?$/.test(path) || path.startsWith("docs/")) return "docs";
  if (
    /(^|\/)(Dockerfile|compose[^/]*\.ya?ml|[^/]*\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|package\.json|turbo\.json|[^/]*\.toml|\.python-version|\.gitignore|\.[^/]+rc(\.json)?)$/.test(
      path,
    ) ||
    path.startsWith(".github/")
  )
    return "config";
  return "source";
}

function layer(path) {
  if (/\.integration\.test\.[jt]sx?$/.test(path)) return "integration";
  if (path.startsWith("apps/web-e2e/") && path.endsWith(".spec.ts")) return "e2e";
  if (path.endsWith(".test.tsx")) return "ui";
  if (/\.test\.[jt]s$/.test(path)) return "unit";
  if (PYTEST.test(path)) return "pytest";
  return null;
}

const STATUS = {
  A: "added",
  M: "modified",
  D: "removed",
  R: "renamed",
  C: "copied",
  T: "modified",
};
const status = new Map();
for (const line of git("diff", "--name-status", "-M", range).trim().split("\n").filter(Boolean)) {
  const [code, ...paths] = line.split("\t");
  status.set(paths.at(-1), {
    change: STATUS[code[0]] ?? "modified",
    from: paths.length > 1 ? paths[0] : undefined,
  });
}

const files = [];
const ignored = { files: 0, lines: 0 };
for (const line of git("diff", "--numstat", "-M", range).trim().split("\n").filter(Boolean)) {
  const [add, del, raw] = line.split("\t");
  // A rename prints as `dir/{old => new}/file` or `old => new`.
  const path = raw.includes("=>")
    ? raw
        .replace(/\{[^}]* => ([^}]*)\}/, "$1")
        .replace(/^.* => /, "")
        .replace(/\/\//g, "/")
    : raw;
  const binary = add === "-";
  const added = binary ? 0 : Number(add);
  const deleted = binary ? 0 : Number(del);
  if (IGNORED.some((re) => re.test(path))) {
    ignored.files += 1;
    ignored.lines += added + deleted;
    continue;
  }
  files.push({
    path,
    area: area(path),
    kind: kind(path),
    added,
    deleted,
    binary,
    ...(status.get(path) ?? { change: "modified" }),
  });
}

// Test cases added and removed per layer, counted from `it(` / `test(` lines (pytest: `def test_`
// functions) in the diff itself.
const CASE = /^[+-]\s*(it|test)(\.(each|only|skip|concurrent|todo)\b[^(]*(\([^)]*\))?)?\(\s*["'`]/;
const PYTEST_CASE = /^[+-]\s*(async\s+)?def\s+test_\w*\s*\(/;
const tests = {
  unit: { added: 0, removed: 0 },
  ui: { added: 0, removed: 0 },
  integration: { added: 0, removed: 0 },
  e2e: { added: 0, removed: 0 },
  pytest: { added: 0, removed: 0 },
};
for (const file of files) {
  const l = layer(file.path);
  if (!l || file.binary) continue;
  const isCase = l === "pytest" ? PYTEST_CASE : CASE;
  for (const line of git("diff", "-M", range, "--", file.path).split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || !isCase.test(line)) continue;
    tests[l][line[0] === "+" ? "added" : "removed"] += 1;
  }
}

const commits = git("log", "--first-parent", "--format=%h%x09%s", `${base}..${head}`)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split("\t");
    return { sha, subject };
  })
  .toReversed();

const totals = files.reduce(
  (t, f) => ({ files: t.files + 1, added: t.added + f.added, deleted: t.deleted + f.deleted }),
  { files: 0, added: 0, deleted: 0 },
);
const facts = { base, head: git("rev-parse", head).trim(), totals, ignored, tests, commits, files };

mkdirSync(values.out, { recursive: true });
writeFileSync(join(values.out, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);

// ---- Mermaid sources -------------------------------------------------------------------------

const q = (s) => s.replace(/"/g, "'");
const churn = (f) => f.added + f.deleted;
const written = [];
const emit = (name, text) => {
  writeFileSync(join(values.out, `${name}.mmd`), `${text}\n`);
  written.push(name);
};

const byArea = Map.groupBy(files, (f) => f.area);

// Where the lines went: area → kind of file. Kind labels differ from every area name (an area
// called `docs` and a kind called `docs` would be one sankey node, a cycle).
const KIND_LABEL = {
  source: "source code",
  tests: "test code",
  docs: "documentation",
  config: "configuration",
  migrations: "migrations",
};
// Areas under 1% of the change and 50 lines fold into one node, so a tail of one-line files
// (symlinks, a gitignore line) stays readable without hiding a small but real area.
const total = files.reduce((n, f) => n + churn(f), 0);
const small = (group) => {
  const lines = group.reduce((n, f) => n + churn(f), 0);
  return lines < total * 0.01 && lines < 50;
};
const folded = Map.groupBy(files, (f) => (small(byArea.get(f.area)) ? "other areas" : f.area));
const flows = [];
for (const [a, group] of folded) {
  for (const [k, kfiles] of Map.groupBy(group, (f) => f.kind)) {
    const lines = kfiles.reduce((n, f) => n + churn(f), 0);
    if (lines > 0) flows.push(`${a.replace(/,/g, " ")},${KIND_LABEL[k]},${lines}`);
  }
}
if (flows.length > 1) emit("mix", ["sankey", ...flows].join("\n"));

// Churn by area and file: each area's largest files by name, the rest folded into one tile, so a
// long tail doesn't drown the files a reviewer should open first. Vendored areas stay out (#11): a
// skill install can be 95% of the lines and shrink every reviewed file to an unlabelled sliver. The
// root label counts what was left out, so the chart doesn't read as the whole change. Small areas
// fold as in the sankey, so a row of one-line symlinks doesn't become a row of empty tiles.
const PER_AREA = 4;
const vendored = (a) => a.endsWith("(vendored)");
const areaChurn = (group) => group.reduce((n, f) => n + churn(f), 0);
const vendoredLines = files.filter((f) => vendored(f.area)).reduce((n, f) => n + churn(f), 0);
const rootLabel = vendoredLines
  ? `Lines changed, excluding ${vendoredLines.toLocaleString("en-US")} vendored`
  : "Lines changed";
const tree = ["treemap-beta", `"${rootLabel}"`];
// Each group's largest files by name (parent and name, since a bare `page.tsx` or `index.ts` says
// nothing), the rest as one tile; a single leftover file is named instead.
const leaves = (group, pad) => {
  const cut = group.length === PER_AREA + 1 ? group.length : PER_AREA;
  const named = group.slice(0, cut);
  const rest = group.slice(cut);
  for (const f of named)
    tree.push(`${pad}"${q(f.path.split("/").slice(-2).join("/"))}": ${churn(f)}`);
  if (rest.length) tree.push(`${pad}"${rest.length} more files": ${areaChurn(rest)}`);
};
// The first folder under the area (`src/`, `tests/`, `migrations/`), or the area's own files.
const subfolder = (a, path) => {
  const rel = path.slice(a.length + 1);
  return rel.includes("/") ? `${rel.split("/")[0]}/` : "(top level)";
};
const reviewed = [...folded].filter(([a]) => !vendored(a));
for (const [a, group] of reviewed.toSorted((x, y) => areaChurn(y[1]) - areaChurn(x[1]))) {
  const sorted = group.filter((f) => churn(f) > 0).toSorted((x, y) => churn(y) - churn(x));
  if (sorted.length === 0) continue;
  tree.push(`  "${q(a)}"`);
  // An area with more files than fit by name splits by folder first (#88): one area can hold most
  // of a change, and a single "N more files" tile would then be the chart's largest, saying nothing.
  const bySub = sorted.every((f) => f.path.startsWith(`${a}/`))
    ? Map.groupBy(sorted, (f) => subfolder(a, f.path))
    : new Map();
  if (sorted.length <= PER_AREA + 1 || bySub.size < 2) {
    leaves(sorted, "    ");
    continue;
  }
  for (const [sub, subFiles] of [...bySub].toSorted((x, y) => areaChurn(y[1]) - areaChurn(x[1]))) {
    tree.push(`    "${q(sub)}"`);
    leaves(subFiles, "      ");
  }
}
// A one- or two-file change is a single tile and a single leaf; the Summary names the files (#99).
const MIN_CHART_FILES = 3;
const charted = files.filter((f) => !vendored(f.area) && churn(f) > 0);
if (charted.length >= MIN_CHART_FILES) emit("churn", tree.join("\n"));

// The changed files as a tree, each leaf carrying its change and line counts.
const root = {};
for (const f of files) {
  let node = root;
  const parts = f.path.split("/");
  for (const dir of parts.slice(0, -1)) node = node[`${dir}/`] ??= {};
  node[parts.at(-1)] = f;
}
const view = ["treeView-beta"];
const walk = (node, depth) => {
  for (const [name, child] of Object.entries(node).toSorted(
    ([x], [y]) => Number(!x.endsWith("/")) - Number(!y.endsWith("/")) || x.localeCompare(y),
  )) {
    const pad = "  ".repeat(depth);
    if (name.endsWith("/")) {
      // Fold single-child directory chains into one line, as GitHub's file tree does.
      let label = name;
      let inner = child;
      while (Object.keys(inner).length === 1 && Object.keys(inner)[0].endsWith("/")) {
        const [only] = Object.keys(inner);
        label += only;
        inner = inner[only];
      }
      view.push(`${pad}${label}`);
      walk(inner, depth + 1);
    } else {
      const counts = child.binary ? "binary" : `+${child.added} −${child.deleted}`;
      view.push(`${pad}${name} ## ${child.change} ${counts}`);
    }
  }
};
walk(root, 1);
if (files.length >= MIN_CHART_FILES && files.length <= 60) emit("files", view.join("\n"));

// Test cases per layer. One layer is one bar with nothing to compare it to, which the Evidence
// section says better (#81), so the chart needs two. pytest counts `def test_` functions, not the
// cases a parametrized one runs, so its axis label says so.
const layers = Object.entries(tests).filter(([, t]) => t.added + t.removed > 0);
const layerLabel = (l) => (l === "pytest" ? '"pytest functions"' : l);
if (layers.length > 1) {
  const max = Math.max(...layers.map(([, t]) => Math.max(t.added, t.removed)));
  emit(
    "tests",
    [
      "xychart",
      `  title "Test cases by layer: added (left), removed (right)"`,
      `  x-axis [${layers.map(([l]) => layerLabel(l)).join(", ")}]`,
      `  y-axis "cases" 0 --> ${Math.ceil(max * 1.15) || 1}`,
      `  bar [${layers.map(([, t]) => t.added).join(", ")}]`,
      `  bar [${layers.map(([, t]) => t.removed).join(", ")}]`,
    ].join("\n"),
  );
}

// The branch's commits, when there are enough to tell a story.
if (commits.length >= 3 && commits.length <= 25) {
  const lines = ["gitGraph", '  commit id: "base"'];
  lines.push("  branch change");
  for (const c of commits) lines.push(`  commit id: "${c.sha} ${q(c.subject).slice(0, 48)}"`);
  emit("commits", lines.join("\n"));
}

console.log(JSON.stringify({ ok: true, out: values.out, totals, ignored, mmd: written }));
