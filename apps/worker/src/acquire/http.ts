import { PermanentError, withRetry, type RetryOptions } from "../retry.js";

/**
 * Fetch a hosted OpenAPI document.
 *
 * Tier B sources have no git history: the document lives at a stable URL and
 * we only see it when we poll. Ingest is the same write path as tier A; only
 * this fetch differs.
 */

const FETCH_TIMEOUT_MS = 60_000;

export interface FetchedSpec {
  text: string;
  /** Last-Modified when the server sends it, otherwise fetch time. */
  providerTime: Date;
  etag: string | null;
  /** The raw Last-Modified header, sent back as If-Modified-Since next time. */
  lastModified: string | null;
}

/** What the previous successful fetch returned, for a conditional request. */
export interface Validators {
  etag?: string | null;
  lastModified?: string | null;
}

/** GET the spec, retrying network errors and 5xx/429. */
export async function fetchSpecUrl(url: string, options: RetryOptions = {}): Promise<FetchedSpec> {
  const result = await fetchSpecUrlIfChanged(url, {}, options);
  if (!result) throw new Error(`GET ${url} → 304 without a conditional request`);
  return result;
}

/**
 * GET the spec only if it changed since `validators`. Returns null on 304.
 *
 * Content hashing already stops an unchanged spec from creating a snapshot;
 * this stops it being downloaded at all, which matters for multi-megabyte
 * specs polled four times a day.
 */
export async function fetchSpecUrlIfChanged(
  url: string,
  validators: Validators,
  options: RetryOptions = {},
): Promise<FetchedSpec | null> {
  return withRetry(() => fetchOnce(url, validators), options);
}

async function fetchOnce(url: string, validators: Validators): Promise<FetchedSpec | null> {
  const headers: Record<string, string> = {
    accept: "application/json, application/yaml, text/yaml, text/plain, */*",
  };
  if (validators.etag) headers["if-none-match"] = validators.etag;
  if (validators.lastModified) headers["if-modified-since"] = validators.lastModified;
  if (validators.etag || validators.lastModified) {
    // The Fetch standard switches a conditional request to cache mode
    // "no-store", which appends `Cache-Control: no-cache` unless one is set.
    // Hetzner's server answers no-cache with a full 200 and ignores the
    // validators, so every poll downloaded 3.5MB it already had. Setting
    // max-age=0 ourselves keeps the revalidation and gets the 304.
    headers["cache-control"] = "max-age=0";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers,
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw new Error(`GET ${url} timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    throw new Error(`GET ${url} failed${cause ? ` (${cause})` : `: ${(err as Error).message}`}`);
  }

  if (response.status === 304) return null;

  if (!response.ok) {
    const message = `GET ${url} → ${response.status} ${response.statusText}`.trim();
    // 5xx and 429 are the server's problem and may pass; any other 4xx will not.
    if (response.status >= 500 || response.status === 429) throw new Error(message);
    throw new PermanentError(message);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new PermanentError(`GET ${url} returned an empty body`);
  }

  const lastModified = response.headers.get("last-modified");
  const parsed = lastModified ? new Date(lastModified) : new Date();
  const providerTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  return {
    text,
    providerTime,
    etag: response.headers.get("etag"),
    lastModified,
  };
}
