import type { JsonObject } from "@driftwatch/core";
import { describe, expect, it } from "vitest";

import { classifyRemoval, documentedValue } from "./schema.js";

const spec = (properties: JsonObject, required: string[] = [], extra: JsonObject = {}): JsonObject => ({
  openapi: "3.1.0",
  paths: {},
  components: { schemas: { Event: { type: "object", properties, required }, ...extra } },
});
const at = "/components/schemas/Event/properties/";

describe("what became of a removed field", () => {
  it("is a rename: one new sibling, same shape, described alike", () => {
    const before = spec({ protect_session_id: { type: "string", description: "Protect Session ID from the SDK." } });
    const after = spec({ device_session_id: { type: "string", description: "Device Session ID from the SDK." } });
    expect(classifyRemoval(before, after, `${at}protect_session_id`, false)).toMatchObject({ kind: "renamed", to: "device_session_id" });
  });

  it("compares through $refs: Cloudflare repointed the field at a renamed component", () => {
    const before = spec({ integration: { $ref: "#/components/schemas/A" } }, [], { A: { type: "string", enum: ["planetscale"] } });
    const after = spec({ provider: { $ref: "#/components/schemas/B" } }, [], { B: { type: "string", enum: ["planetscale"] } });
    expect(classifyRemoval(before, after, `${at}integration`, false)).toMatchObject({ kind: "renamed", to: "provider" });
  });

  it("is only maybe replaced when the new field is described as something else", () => {
    // Stripe Checkout: payment_method_types → allowed_payment_method_types.
    const list = { type: "array", items: { type: "string" } };
    const before = spec({ payment_method_types: { ...list, description: "A list of the types of payment methods this session can accept." } });
    const after = spec({
      allowed_payment_method_types: {
        ...list,
        description: "Unlike `payment_method_types`, this acts as a filter on the dynamically computed set of eligible payment methods.",
      },
    });
    expect(classifyRemoval(before, after, `${at}payment_method_types`, false)).toEqual({
      kind: "replaced-maybe",
      candidates: ["allowed_payment_method_types"],
    });
  });

  it("is only maybe replaced when a related name appears with another shape", () => {
    // Stripe: filters.countries (a list) became filters.country (a string).
    const before = spec({ countries: { type: "array", items: { type: "string" } } });
    const after = spec({ country: { type: "string" } });
    expect(classifyRemoval(before, after, `${at}countries`, false)).toEqual({ kind: "replaced-maybe", candidates: ["country"] });
  });

  it("is ambiguous when two removed fields fit the one new field", () => {
    const before = spec({ a: { type: "string" }, b: { type: "string" } });
    const after = spec({ c: { type: "string" } });
    expect(classifyRemoval(before, after, `${at}a`, false).kind).not.toBe("renamed");
  });

  it("is a removal otherwise, and says whether it was optional", () => {
    const before = spec({ a: { type: "string" }, b: { type: "integer" } }, ["b"]);
    const after = spec({ c: { type: "boolean" } });
    expect(classifyRemoval(before, after, `${at}a`, false)).toMatchObject({ kind: "removed", optional: true });
    expect(classifyRemoval(before, after, `${at}b`, false)).toMatchObject({ kind: "removed", optional: false });
  });

  it("is unknown without an earlier spec", () => {
    expect(classifyRemoval(undefined, spec({}), `${at}a`, false).kind).toBe("unknown");
  });
});

describe("the documented value of a newly required field", () => {
  const value = (schema: JsonObject) => documentedValue(spec({}), schema);

  it("is a const, a single-value enum, or a default", () => {
    expect(value({ const: "v1" })).toEqual({ found: true, value: "v1", source: "const" });
    expect(value({ type: "string", enum: ["override_shift"] })).toEqual({ found: true, value: "override_shift", source: "enum" });
    expect(value({ type: "integer", default: 10 })).toEqual({ found: true, value: 10, source: "default" });
  });

  it("is nothing for an open field, or a choice", () => {
    expect(value({ type: ["string", "null"] }).found).toBe(false);
    expect(value({ type: "string", enum: ["now", "unchanged"] }).found).toBe(false);
  });

  it("is never a deprecated value", () => {
    // OpenAI documented dall-e-2 as retired; a default of it is no answer.
    const schema = { type: "string", default: "dall-e-2", "x-openai-enum-deprecations": { "dall-e-2": { message: "retired" } } };
    expect(value(schema).found).toBe(false);
  });
});
