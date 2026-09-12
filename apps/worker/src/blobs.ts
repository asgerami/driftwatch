import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { paths } from "./config.js";

/**
 * Content-addressed blob store on the local filesystem.
 *
 * Specs are large and mostly unchanged between versions, so addressing by
 * hash means a provider that republishes an identical document costs nothing,
 * and two sources that happen to ship the same bytes share one file.
 * Swap this module for object storage when it outgrows one box; nothing
 * upstream knows where the bytes live.
 */

function keyFor(hash: string, ext: string): string {
  return join(hash.slice(0, 2), `${hash}${ext}`);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Writes only if absent. Returns the storage key. */
export async function putText(text: string, ext = ".json.gz"): Promise<string> {
  const hash = hashText(text);
  const key = keyFor(hash, ext);
  const full = join(paths.blobs, key);

  if (existsSync(full)) return key;

  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, gzipSync(Buffer.from(text, "utf8")));
  return key;
}

export async function getText(key: string): Promise<string> {
  const buf = await readFile(join(paths.blobs, key));
  return gunzipSync(buf).toString("utf8");
}
