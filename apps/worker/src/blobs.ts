import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { AwsClient } from "aws4fetch";

import { config, paths } from "./config.js";

/**
 * Content-addressed blob store.
 *
 * Specs are large and mostly unchanged between versions, so addressing by
 * hash means a provider that republishes an identical document costs nothing,
 * and two sources that happen to ship the same bytes share one object.
 *
 * Two backends behind one interface. With R2 configured, blobs live in the
 * bucket: the scheduled job runs on a GitHub Actions runner whose disk is
 * wiped after every run, and `diff` has to read back the previous version.
 * Without it, they live under DATA_DIR/blobs, as they always have. Keys are
 * identical in both, so nothing upstream knows where the bytes live.
 */

interface Backend {
  readonly name: string;
  has(key: string): Promise<boolean>;
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const local: Backend = {
  name: `local (${paths.blobs})`,
  async has(key) {
    return existsSync(join(paths.blobs, key));
  },
  async put(key, body) {
    const full = join(paths.blobs, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  },
  async get(key) {
    return readFile(join(paths.blobs, key));
  },
};

const R2_ATTEMPTS = 3;

/**
 * Per attempt, body included. Without it a connection that dies mid-request
 * (a laptop going to sleep, a dropped route) hangs forever instead of
 * failing: one backfill sat silent for over two hours before this existed.
 * The largest blob is a few MB, so a minute is generous.
 */
const R2_TIMEOUT_MS = 60_000;

function r2Backend(r2: typeof config.r2): Backend {
  const client = new AwsClient({
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  // A 5xx or a dropped connection is retried; a 4xx is our mistake and is not.
  async function send(method: string, key: string, body?: Buffer): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= R2_ATTEMPTS; attempt++) {
      try {
        const response = await client.fetch(`${r2.baseUrl}/${key}`, {
          method,
          signal: AbortSignal.timeout(R2_TIMEOUT_MS),
          ...(body ? { body, headers: { "content-type": "application/gzip" } } : {}),
        });
        if (response.status < 500) return response;
        lastError = new Error(`R2 ${method} ${key} → ${response.status}`);
      } catch (err) {
        lastError = err as Error;
      }
      if (attempt < R2_ATTEMPTS) {
        await new Promise((done) => setTimeout(done, 500 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  return {
    name: `r2 (${r2.baseUrl.replace(/^https:\/\/[^/]+\//, "")})`,
    async has(key) {
      const response = await send("HEAD", key);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 HEAD ${key} → ${response.status}`);
      return true;
    },
    async put(key, body) {
      const response = await send("PUT", key, body);
      if (!response.ok) {
        throw new Error(`R2 PUT ${key} → ${response.status} ${await response.text()}`);
      }
    },
    async get(key) {
      const response = await send("GET", key);
      if (!response.ok) throw new Error(`R2 GET ${key} → ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

/**
 * All three R2 settings, or none. A partial set is a typo, and falling back
 * to local disk would let a scheduled job store every blob on a runner that
 * is about to be thrown away.
 */
function selectBackend(): Backend {
  const { baseUrl, accessKeyId, secretAccessKey } = config.r2;
  const set = [baseUrl, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (set === 0) return local;
  if (set < 3) {
    throw new Error(
      "R2 is partly configured. Set all of R2_BASE_URL, R2_ACCESS_KEY_ID and " +
        "R2_SECRET_ACCESS_KEY, or none of them to use local disk.",
    );
  }
  return r2Backend(config.r2);
}

let backend: Backend | undefined;

function store(): Backend {
  backend ??= selectBackend();
  return backend;
}

export function blobStoreName(): string {
  return store().name;
}

function keyFor(hash: string, ext: string): string {
  return `${hash.slice(0, 2)}/${hash}${ext}`;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Writes only if absent. Returns the storage key. */
export async function putText(text: string, ext = ".json.gz"): Promise<string> {
  const key = keyFor(hashText(text), ext);
  if (await store().has(key)) return key;
  await store().put(key, gzipSync(Buffer.from(text, "utf8")));
  return key;
}

export async function getText(key: string): Promise<string> {
  return gunzipSync(await store().get(key)).toString("utf8");
}
