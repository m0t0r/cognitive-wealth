// The fixer's API key, kept away from the checks it runs. `run_check` runs scripts the model may
// have edited, as children of this process: stripping a variable from their environment isn't
// enough, since a child can read its parent's starting environment in `/proc/<pid>/environ`. So
// `friction-fix.yml` hands the key over as a file (ANTHROPIC_API_KEY_FILE) instead, which this reads
// and deletes before the loop starts, so the key lives only in this process's memory. That stops
// a check reading it from an environment or a file, not one set on it: on a GitHub-hosted runner the
// user has passwordless sudo and the docker group, either of which can read this process's memory.
// So the fixer's key should be one of its own with a low spend limit; a real boundary would run the
// checks in a separate sandbox without the key or the network.
import { readFile, rm } from "node:fs/promises";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** The key in ANTHROPIC_API_KEY_FILE, with the file deleted; undefined when it isn't set. */
export async function takeKeyFile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const path = env.ANTHROPIC_API_KEY_FILE;
  if (!path) return undefined;
  const key = (await readFile(path, "utf8")).trim();
  await rm(path, { force: true });
  delete env.ANTHROPIC_API_KEY_FILE;
  return key;
}

/**
 * `modelId` on the key from ANTHROPIC_API_KEY_FILE, or undefined without one, for the caller's
 * default (the AI SDK reads ANTHROPIC_API_KEY, as triage and a local run do).
 */
export async function modelFromKeyFile(modelId: string): Promise<LanguageModel | undefined> {
  const apiKey = await takeKeyFile();
  return apiKey ? createAnthropic({ apiKey })(modelId) : undefined;
}
