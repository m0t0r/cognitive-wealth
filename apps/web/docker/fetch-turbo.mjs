// Downloads the turbo binary package for this platform at the exact version in the root
// package.json, and verifies it against the sha512 committed in pnpm-lock.yaml (which Dependabot
// keeps current). Writes the verified tarball to the path in argv[2].
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).devDependencies.turbo;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error(`Pin turbo to an exact version, not ${version}`);

const arch = { x64: "64", arm64: "arm64" }[process.arch];
if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);
const name = `linux-${arch}`;

const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
const integrity = new RegExp(
  `^  '@turbo/${name}@${version.replaceAll(".", "\\.")}':\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}`,
  "m",
).exec(lockfile)?.[1];
if (!integrity) throw new Error(`pnpm-lock.yaml has no integrity for @turbo/${name}@${version}`);

const response = await fetch(`https://registry.npmjs.org/@turbo/${name}/-/${name}-${version}.tgz`);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const tarball = Buffer.from(await response.arrayBuffer());

const actual = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
if (actual !== integrity)
  throw new Error(`Integrity mismatch: expected ${integrity}, got ${actual}`);

writeFileSync(process.argv[2], tarball);
