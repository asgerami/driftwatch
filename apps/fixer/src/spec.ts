import { readFile } from "node:fs/promises";

import { normalizeSpec, type ChangeDocument, type JsonObject } from "@driftwatch/core";

import { fetchText } from "./change.js";

/**
 * The provider's spec as it was right after the change, normalized exactly as
 * the pipeline normalized it. Fetched from the source the change names (the
 * git commit, or the hosted URL) unless a local file is given.
 */
export async function loadSpec(change: ChangeDocument, specFile?: string): Promise<JsonObject> {
  let text: string;
  if (specFile) {
    text = await readFile(specFile, "utf8");
  } else if (change.spec.kind === "git") {
    text = await fetchText(
      `https://raw.githubusercontent.com/${change.spec.repo}/${change.spec.toSha}/${change.spec.filePath}`,
    );
  } else {
    text = await fetchText(change.spec.url);
  }
  return (await normalizeSpec(text)).document;
}

/**
 * The spec as it was before the change, for what only a comparison can tell:
 * whether a removed field was renamed, and whether it was optional. Hosted
 * sources keep no history, so there is none for them.
 */
export async function loadSpecBefore(change: ChangeDocument, specFile?: string): Promise<JsonObject | undefined> {
  if (specFile) return (await normalizeSpec(await readFile(specFile, "utf8"))).document;
  if (change.spec.kind !== "git" || !change.spec.fromSha) return undefined;
  const text = await fetchText(
    `https://raw.githubusercontent.com/${change.spec.repo}/${change.spec.fromSha}/${change.spec.filePath}`,
  );
  return (await normalizeSpec(text)).document;
}
