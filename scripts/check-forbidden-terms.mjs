#!/usr/bin/env node
// Fails when a tracked or new file contains a forbidden term, such as the name of a company that
// inspired the product. The repo is public, so the list itself can't live in it: it is read from
// `info/forbidden-terms` in the git common dir (shared by every worktree), one case-insensitive
// term per line, `#` for comments. Without that file there is nothing to check.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
// `ls-files` paths are relative to the top level, so read them from there.
process.chdir(git("rev-parse", "--show-toplevel").trim());

const listPath = join(
  git("rev-parse", "--path-format=absolute", "--git-common-dir").trim(),
  "info",
  "forbidden-terms",
);
if (!existsSync(listPath)) {
  console.log(`No ${listPath}; skipping the forbidden-terms check.`);
  process.exit(0);
}
const terms = readFileSync(listPath, "utf8")
  .split("\n")
  .map((line) => line.trim().toLowerCase())
  .filter((line) => line && !line.startsWith("#"));

const files = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  .split("\0")
  .filter(Boolean);
const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file);
  } catch {
    continue; // deleted in the working tree but still in the index
  }
  if (text.includes(0)) continue; // binary
  const lines = text.toString("utf8").toLowerCase().split("\n");
  lines.forEach((line, i) => {
    for (const term of terms)
      if (line.includes(term))
        hits.push(`${file}:${i + 1}: matches term ${terms.indexOf(term) + 1}`);
  });
}

if (hits.length) {
  console.error(`Forbidden terms found (list: ${listPath}):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`No forbidden terms in ${files.length} files.`);
