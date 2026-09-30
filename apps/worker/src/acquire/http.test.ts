import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSpecUrl, fetchSpecUrlIfChanged } from "./http.js";

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

describe("fetchSpecUrlIfChanged", () => {
  const noWait = { sleep: async () => {} };
  const spec = '{"openapi":"3.0.3","info":{"title":"T","version":"1"},"paths":{}}';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the validators and returns null on 304", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    const got = await fetchSpecUrlIfChanged(
      "https://example.test/openapi.json",
      { etag: '"abc"', lastModified: "Wed, 01 Jan 2025 00:00:00 GMT" },
      noWait,
    );
    expect(got).toBeNull();
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["if-none-match"]).toBe('"abc"');
    expect(headers["if-modified-since"]).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
    // Without it, fetch sends Cache-Control: no-cache and Hetzner answers 200.
    expect(headers["cache-control"]).toBe("max-age=0");
  });

  it("retries a 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(spec, { status: 200, headers: { etag: '"v2"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const got = await fetchSpecUrlIfChanged("https://example.test/openapi.json", {}, noWait);
    expect(got?.etag).toBe('"v2"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a dropped connection, then names the cause", async () => {
    const dropped = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    const fetchMock = vi.fn(async () => {
      throw dropped;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSpecUrlIfChanged("https://example.test/openapi.json", {}, noWait),
    ).rejects.toThrow(/UND_ERR_CONNECT_TIMEOUT/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404, which retrying cannot fix", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSpecUrlIfChanged("https://example.test/openapi.json", {}, noWait),
    ).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
