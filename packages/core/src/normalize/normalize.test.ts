import { describe, expect, it } from "vitest";
import { normalizeSpec } from "./index.js";
import { canonicalizeDocument, stripPointers } from "./canonicalize.js";
import type { JsonObject } from "../types.js";

/**
 * These tests encode the promise the product makes: reordering is not change.
 * If one of them fails, the feed is about to publish a false positive.
 */

// Deliberately loose so fixtures can be mutated freely in each case.
type Doc = Record<string, any>;

function fixture(): Doc {
  return {
    openapi: "3.0.3",
    info: { title: "Demo", version: "1.0.0" },
    paths: {
      "/v1/charges": {
        post: {
          operationId: "createCharge",
          tags: ["charges", "billing"],
          parameters: [
            { name: "expand", in: "query", schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
          ],
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

const canon = (doc: Doc) => JSON.stringify(canonicalizeDocument(doc as JsonObject));

describe("canonicalization", () => {
  it("is insensitive to object key order", () => {
    expect(canon({ b: 1, a: 2, c: { z: 1, y: 2 } })).toBe(
      canon({ c: { y: 2, z: 1 }, a: 2, b: 1 }),
    );
  });

  it("sorts parameters by (in, name) so generator shuffles do not read as change", () => {
    const base = fixture();
    const swapped = fixture();
    const params = swapped["paths"]["/v1/charges"].post.parameters;
    swapped["paths"]["/v1/charges"].post.parameters = [params[1], params[0]];

    expect(canon(base)).toBe(canon(swapped));
  });

  it("sorts enum members, which are a set", () => {
    expect(canon({ enum: ["c", "a", "b"] })).toBe(canon({ enum: ["a", "b", "c"] }));
  });

  it("leaves allOf alone, because later members override earlier ones", () => {
    expect(canon({ allOf: [{ x: 1 }, { x: 2 }] })).toBe(
      JSON.stringify({ allOf: [{ x: 1 }, { x: 2 }] }),
    );
  });
});

describe("volatile pointer stripping", () => {
  it("removes the pointed-at value and unescapes ~1 as a slash", () => {
    const out = stripPointers(fixture() as JsonObject, [
      "/paths/~1v1~1charges/post/operationId",
    ]) as Doc;
    expect(out["paths"]["/v1/charges"].post.operationId).toBeUndefined();
    // Siblings survive.
    expect(out["paths"]["/v1/charges"].post.responses["200"]).toBeDefined();
  });

  it("ignores pointers that do not resolve", () => {
    const base = fixture();
    const out = stripPointers(base as JsonObject, ["/nope/missing"]);
    expect(JSON.stringify(out)).toBe(JSON.stringify(base));
  });
});

describe("normalizeSpec", () => {
  it("produces the same hash for two orderings of the same surface", async () => {
    const shuffled = fixture();
    const params = shuffled["paths"]["/v1/charges"].post.parameters;
    shuffled["paths"]["/v1/charges"].post.parameters = [params[1], params[0]];
    shuffled["paths"]["/v1/charges"].post.tags = ["billing", "charges"];

    const a = await normalizeSpec(JSON.stringify(fixture()));
    const b = await normalizeSpec(JSON.stringify(shuffled));
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("produces a different hash when the surface actually changes", async () => {
    const changed = fixture();
    changed["paths"]["/v1/charges"].post.responses["404"] = { description: "gone" };

    const a = await normalizeSpec(JSON.stringify(fixture()));
    const b = await normalizeSpec(JSON.stringify(changed));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("ignores a volatile pointer when hashing", async () => {
    const bumped = fixture();
    bumped["info"].version = "2.0.0";

    const opts = { volatilePointers: ["/info/version"] };
    const a = await normalizeSpec(JSON.stringify(fixture()), opts);
    const b = await normalizeSpec(JSON.stringify(bumped), opts);
    expect(a.contentHash).toBe(b.contentHash);

    // ...but not when it is left in.
    const c = await normalizeSpec(JSON.stringify(fixture()));
    const d = await normalizeSpec(JSON.stringify(bumped));
    expect(c.contentHash).not.toBe(d.contentHash);
  });

  it("reads YAML as well as JSON", async () => {
    const yaml = [
      "openapi: 3.0.3",
      "info:",
      "  title: Demo",
      "  version: 1.0.0",
      "paths: {}",
    ].join("\n");
    const out = await normalizeSpec(yaml);
    expect(out.oasVersion).toBe("3.0.3");
    expect(out.stats.pathCount).toBe(0);
  });

  it("upgrades swagger 2.0 to OAS 3", async () => {
    const swagger2 = {
      swagger: "2.0",
      info: { title: "Legacy", version: "1.0.0" },
      paths: { "/ping": { get: { responses: { "200": { description: "ok" } } } } },
    };
    const out = await normalizeSpec(JSON.stringify(swagger2));
    expect(out.upgradedFromSwagger2).toBe(true);
    expect(out.sourceVersion).toBe("2.0");
    expect(out.oasVersion.startsWith("3.")).toBe(true);
    expect(out.stats.opCount).toBe(1);
  });

  it("counts operations, not paths", async () => {
    const multi = fixture();
    multi["paths"]["/v1/charges"].get = { responses: { "200": { description: "ok" } } };
    const out = await normalizeSpec(JSON.stringify(multi));
    expect(out.stats.pathCount).toBe(1);
    expect(out.stats.opCount).toBe(2);
  });

  it("survives an internal circular $ref, which dereferencing would not", async () => {
    const circular: Doc = {
      openapi: "3.0.3",
      info: { title: "Circular", version: "1.0.0" },
      paths: {
        "/charges": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Charge" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Charge: {
            type: "object",
            properties: { customer: { $ref: "#/components/schemas/Customer" } },
          },
          Customer: {
            type: "object",
            properties: { charge: { $ref: "#/components/schemas/Charge" } },
          },
        },
      },
    };

    const out = await normalizeSpec(JSON.stringify(circular));
    expect(out.contentHash).toHaveLength(64);
    expect(out.stats.opCount).toBe(1);
    expect(out.stats.schemaCount).toBe(2);
  });
});
