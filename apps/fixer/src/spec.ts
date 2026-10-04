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
