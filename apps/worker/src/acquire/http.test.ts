import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSpecUrl } from "./http.js";

describe("fetchSpecUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the body and Last-Modified as providerTime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response('{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{}}', {
          status: 200,
          headers: {
            "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
            etag: '"abc"',
          },
        });
      }),
    );

    const got = await fetchSpecUrl("https://example.test/openapi.json");
    expect(got.text).toContain("openapi");
    expect(got.providerTime.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(got.etag).toBe('"abc"');
  });

  it("fails loudly on a non-2xx so poll can skip the source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" })),
    );

    await expect(fetchSpecUrl("https://example.test/missing.json")).rejects.toThrow(
      /GET https:\/\/example.test\/missing.json → 404/,
    );
  });

  it("rejects an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("  ", { status: 200 })));
    await expect(fetchSpecUrl("https://example.test/empty.json")).rejects.toThrow(/empty body/);
  });

  it("falls back to fetch time when Last-Modified is junk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response('{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{}}', {
          status: 200,
          headers: { "last-modified": "not-a-date" },
        });
      }),
    );

    const before = Date.now();
    const got = await fetchSpecUrl("https://example.test/openapi.json");
    expect(got.providerTime.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(got.providerTime.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
