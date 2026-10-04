import { readFile } from "node:fs/promises";

import type { ChangeDocument } from "@driftwatch/core";

/**
 * Load a published change: an id (fetched from the public site), an http(s)
 * URL to its JSON, or a local file (fixtures, offline work).
 */

const SITE_URL = (process.env["DRIFTWATCH_SITE_URL"] ?? "https://driftwatch.et").replace(/\/+$/, "");

export async function loadChange(ref: string): Promise<ChangeDocument> {
  let text: string;
  if (/^https?:\/\//.test(ref)) {
    text = await fetchText(ref);
  } else if (ref.endsWith(".json")) {
    text = await readFile(ref, "utf8");
  } else {
    text = await fetchText(`${SITE_URL}/api/changes/${encodeURIComponent(ref)}`);
  }
  const document = JSON.parse(text) as ChangeDocument;
  if (document.version !== 1 || !Array.isArray(document.facts)) {
    throw new Error(`${ref} is not a Driftwatch change document`);
  }
  return document;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return response.text();
}
