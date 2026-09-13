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
}

export async function fetchSpecUrl(url: string): Promise<FetchedSpec> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/json, application/yaml, text/yaml, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`GET ${url} → ${response.status} ${response.statusText}`.trim());
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error(`GET ${url} returned an empty body`);
    }

    const lastModified = response.headers.get("last-modified");
    const parsed = lastModified ? new Date(lastModified) : new Date();
    const providerTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

    return {
      text,
      providerTime,
      etag: response.headers.get("etag"),
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`GET ${url} timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
