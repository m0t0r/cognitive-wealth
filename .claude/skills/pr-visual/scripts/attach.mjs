#!/usr/bin/env node
// Publishes a PR body whose images are local files, through `gh` only:
//
//   node attach.mjs <pr> <body.md>      (the body's ./paths resolve from its own directory)
//
// `gh pr edit --attach` uploads to GitHub's attachment storage, but it rewrites a body reference
// only when it's exactly `./file.png`. A theme fragment (`./x.light.png#gh-light-mode-only`) or an
// HTML `src` is left alone and the upload is appended instead. So: upload every ./file the body
// names into a placeholder body, read the appended URLs back (gh appends them in --attach order),
// substitute them into the real body, fragments kept, and publish that.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [pr, bodyPath] = process.argv.slice(2);
if (!pr || !bodyPath) throw new Error("usage: attach.mjs <pr> <body.md>");

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let body = readFileSync(bodyPath, "utf8");

// Every ./file reference in Markdown links or src/srcset attributes, in order of first use.
const REF = /(\]\(|(?:src|srcset)=")\.\/([^)#"\s]+)/g;
const files = [...new Set([...body.matchAll(REF)].map((m) => m[2]))];
const bodyDir = dirname(resolve(bodyPath));
const missing = files.filter((f) => !existsSync(join(bodyDir, f)));
if (missing.length) throw new Error(`Not found in ${bodyDir}: ${missing.join(", ")}`);

const urls = new Map();
const placeholder = join(tmpdir(), `pr-${pr}-uploading.md`);
const ATTACHMENT = /\]\((https:\/\/github\.com\/user-attachments\/assets\/[^)\s]+)\)/g;
// gh takes up to 50 files per call.
for (let i = 0; i < files.length; i += 50) {
  const batch = files.slice(i, i + 50);
  writeFileSync(placeholder, "Uploading images…\n");
  gh(
    "pr",
    "edit",
    pr,
    "--body-file",
    placeholder,
    ...batch.flatMap((f) => ["--attach", join(bodyDir, f)]),
  );
  const uploaded = [
    ...gh("pr", "view", pr, "--json", "body", "--jq", ".body").matchAll(ATTACHMENT),
  ].map((m) => m[1]);
  if (uploaded.length !== batch.length) {
    throw new Error(
      `Uploaded ${uploaded.length} of ${batch.length} files; the PR body holds what did upload`,
    );
  }
  batch.forEach((f, j) => urls.set(f, uploaded[j]));
}

body = body.replace(REF, (_, lead, file) => `${lead}${urls.get(file)}`);
const final = join(tmpdir(), `pr-${pr}-body.md`);
writeFileSync(final, body);
gh("pr", "edit", pr, "--body-file", final);
console.log(JSON.stringify({ ok: true, pr, uploaded: files.length }));
