import { randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { afterAll, describe, expect, it } from "vitest";

import { blobStoreName, getText, putText } from "./blobs.js";
import { config } from "./config.js";

/**
 * Round-trips a blob through the real R2 bucket.
 *
 * Skipped unless all three R2 settings are present, so `pnpm check` runs on
 * a machine with no Cloudflare account. The key is random, so the object is
 * deleted afterwards rather than left to accumulate.
 */

const hasR2 = Boolean(
  config.r2.baseUrl && config.r2.accessKeyId && config.r2.secretAccessKey,
);

describe.skipIf(!hasR2)("blob store against R2", () => {
  const written: string[] = [];

  afterAll(async () => {
    const client = new AwsClient({
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    for (const key of written) {
      await client.fetch(`${config.r2.baseUrl}/${key}`, { method: "DELETE" });
    }
  });

  it("uses R2, and reads back exactly what it wrote", async () => {
    expect(blobStoreName()).toMatch(/^r2 /);

    const text = JSON.stringify({ probe: randomUUID(), note: "ünïcode ✓" });
    const key = await putText(text);
    written.push(key);

    expect(key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}\.json\.gz$/);
    expect(await getText(key)).toBe(text);
    // Content-addressed: the same bytes land on the same key.
    expect(await putText(text)).toBe(key);
  }, 30_000);
});
