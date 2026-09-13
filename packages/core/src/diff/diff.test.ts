import { describe, expect, it } from "vitest";
import { diffDocuments } from "./index.js";
import type { JsonObject } from "../types.js";

type Doc = Record<string, any>;

function doc(paths: Doc, components?: Doc): JsonObject {
  return {
    openapi: "3.0.3",
    info: { title: "T", version: "1" },
    paths,
    ...(components ? { components } : {}),
  } as JsonObject;
}

function jsonOp(schema: Doc, extra: Doc = {}): Doc {
  return {
    responses: {
      "200": {
        description: "ok",
        content: { "application/json": { schema } },
      },
    },
    ...extra,
  };
}

const ids = (result: { changes: { ruleId: string }[] }) =>
  result.changes.map((c) => c.ruleId);

function only(result: { changes: any[] }, ruleId: string) {
  return result.changes.filter((c) => c.ruleId === ruleId);
}

describe("endpoint surface", () => {
  it("detects a removed path", () => {
    const before = doc({ "/a": { get: jsonOp({ type: "object" }) } });
    const after = doc({});
    expect(ids(diffDocuments(before, after))).toContain("path.removed");
  });

  it("detects a removed verb on a surviving path", () => {
    const before = doc({ "/a": { get: jsonOp({}), post: jsonOp({}) } });
    const after = doc({ "/a": { get: jsonOp({}) } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toContain("operation.removed");
    expect(ids(result)).not.toContain("path.removed");
  });

  it("treats deprecation as its own predictive signal", () => {
    const before = doc({ "/a": { get: jsonOp({}) } });
    const after = doc({ "/a": { get: jsonOp({}, { deprecated: true }) } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toContain("operation.deprecated");
    expect(only(result, "operation.deprecated")[0].severity).toBe("DEPRECATION");
  });

  it("reports nothing for two identical documents", () => {
    const a = doc({ "/a": { get: jsonOp({ type: "object", properties: { x: { type: "string" } } }) } });
    expect(diffDocuments(a, structuredClone(a)).changes).toHaveLength(0);
  });
});

describe("direction flip 1 — response field loses its guarantee", () => {
  it("fires when a response property drops out of required", () => {
    const schema = (required: string[]) => ({
      type: "object",
      required,
      properties: { id: { type: "string" }, email: { type: "string" } },
    });
    const before = doc({ "/u": { get: jsonOp(schema(["id", "email"])) } });
    const after = doc({ "/u": { get: jsonOp(schema(["id"])) } });

    const hits = only(diffDocuments(before, after), "response.property.became-optional");
    expect(hits).toHaveLength(1);
    expect(hits[0].fieldPath).toBe("email");
    expect(hits[0].severity).toBe("BREAKING");
    expect(hits[0].directionFlip).toBe(true);
  });

  it("also fires when a response field merely becomes nullable", () => {
    const before = doc({ "/u": { get: jsonOp({ type: "object", properties: { name: { type: "string" } } }) } });
    const after = doc({ "/u": { get: jsonOp({ type: "object", properties: { name: { type: "string", nullable: true } } }) } });

    const hits = only(diffDocuments(before, after), "response.property.became-optional");
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toBe("can now be null");
  });

  it("does NOT fire in the request direction, where losing a requirement is a relaxation", () => {
    const body = (required: string[]) => ({
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object", required, properties: { a: { type: "string" } } },
          },
        },
      },
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/x": { post: body(["a"]) } });
    const after = doc({ "/x": { post: body([]) } });
    expect(ids(diffDocuments(before, after))).not.toContain(
      "response.property.became-optional",
    );
  });
});

describe("direction flip 2 — new enum value in a response", () => {
  it("is BREAKING for a consumer, though producers call it additive", () => {
    const schema = (values: string[]) => ({
      type: "object",
      properties: { status: { type: "string", enum: values } },
    });
    const before = doc({ "/o": { get: jsonOp(schema(["open", "closed"])) } });
    const after = doc({ "/o": { get: jsonOp(schema(["open", "closed", "disputed"])) } });

    const hits = only(diffDocuments(before, after), "response.enum.value-added");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("BREAKING");
    expect(hits[0].directionFlip).toBe(true);
    expect(hits[0].detail).toContain("disputed");
  });

  it("inverts for requests: there, a WITHDRAWN value is the break", () => {
    const param = (values: string[]) => ({
      parameters: [{ name: "sort", in: "query", schema: { type: "string", enum: values } }],
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/o": { get: param(["asc", "desc"]) } });
    const after = doc({ "/o": { get: param(["asc"]) } });

    const result = diffDocuments(before, after);
    expect(ids(result)).toContain("request.enum.value-removed");
    expect(ids(result)).not.toContain("response.enum.value-added");
  });
});

describe("direction flip 3 — a removed request parameter throws no error", () => {
  it("is BREAKING and says so", () => {
    const before = doc({
      "/s": {
        get: {
          parameters: [{ name: "expand", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    });
    const after = doc({ "/s": { get: { responses: { "200": { description: "ok" } } } } });

    const hits = only(diffDocuments(before, after), "request.param.removed");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("BREAKING");
    expect(hits[0].consequence).toContain("No error is raised");
  });

  it("does not call a dropped $ref a removal when the shared parameter still exists", () => {
    // GitHub 33438507 → 1048c01d: classroom list ops stopped $refing page and
    // per-page. The components remained, and 250+ other operations kept them.
    const page = { name: "page", in: "query", schema: { type: "integer" } };
    const perPage = { name: "per_page", in: "query", schema: { type: "integer" } };
    const assignmentId = {
      name: "assignment_id",
      in: "path",
      required: true,
      schema: { type: "string" },
    };
    const before = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/assignments/{assignment_id}/accepted_assignments": {
          get: {
            parameters: [
              { $ref: "#/components/parameters/assignment-id" },
              { $ref: "#/components/parameters/page" },
              { $ref: "#/components/parameters/per-page" },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
        "/events": {
          get: {
            parameters: [
              { $ref: "#/components/parameters/page" },
              { $ref: "#/components/parameters/per-page" },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: {
        parameters: {
          "assignment-id": assignmentId,
          page,
          "per-page": perPage,
        },
      },
    } as JsonObject;
    const after = structuredClone(before) as JsonObject;
    (after as any).paths["/assignments/{assignment_id}/accepted_assignments"].get.parameters = [
      { $ref: "#/components/parameters/assignment-id" },
    ];

    const result = diffDocuments(before, after);
    expect(only(result, "request.param.removed")).toHaveLength(0);
    const unlisted = only(result, "request.param.unlisted");
    expect(unlisted.map((c) => c.fieldPath).sort()).toEqual(["page", "per_page"]);
    expect(unlisted.every((c) => c.severity === "COSMETIC")).toBe(true);
    expect(unlisted.every((c) => c.publishable === false)).toBe(true);
  });

  it("still flags a shared parameter that vanished from the whole API", () => {
    const page = { name: "page", in: "query", schema: { type: "integer" } };
    const before = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/events": {
          get: {
            parameters: [{ $ref: "#/components/parameters/page" }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: { parameters: { page } },
    } as JsonObject;
    const after = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: {
        "/events": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
      components: { parameters: {} },
    } as JsonObject;

    const hits = only(diffDocuments(before, after), "request.param.removed");
    expect(hits).toHaveLength(1);
    expect(hits[0].fieldPath).toBe("page");
    expect(only(diffDocuments(before, after), "request.param.unlisted")).toHaveLength(0);
  });
});

describe("request rules", () => {
  it("flags a new required parameter", () => {
    const before = doc({ "/s": { get: { responses: { "200": { description: "ok" } } } } });
    const after = doc({
      "/s": {
        get: {
          parameters: [{ name: "version", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    });
    expect(ids(diffDocuments(before, after))).toContain("request.param.required-added");
  });

  it("treats a new optional parameter as additive", () => {
    const before = doc({ "/s": { get: { responses: { "200": { description: "ok" } } } } });
    const after = doc({
      "/s": {
        get: {
          parameters: [{ name: "hint", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    });
    const hits = only(diffDocuments(before, after), "request.param.optional-added");
    expect(hits[0].severity).toBe("ADDITIVE");
    expect(hits[0].publishable).toBe(true);
  });

  it("catches the int64-to-string identifier migration via format", () => {
    const schema = (format: string) => ({
      type: "object",
      properties: { id: { type: "integer", format } },
    });
    const before = doc({ "/i": { get: jsonOp(schema("int64")) } });
    const after = doc({ "/i": { get: jsonOp(schema("int32")) } });
    const hits = only(diffDocuments(before, after), "response.property.type-changed");
    expect(hits[0].detail).toBe("format int64 → int32");
  });
});

describe("pagination and defaults", () => {
  it("recognizes a pagination default change by parameter name", () => {
    const withDefault = (value: number) => ({
      parameters: [{ name: "per_page", in: "query", schema: { type: "integer", default: value } }],
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/l": { get: withDefault(100) } });
    const after = doc({ "/l": { get: withDefault(30) } });

    const hits = only(diffDocuments(before, after), "pagination.default-changed");
    expect(hits).toHaveLength(1);
    expect(hits[0].consequence).toContain("Silent truncation");
  });

  it("falls back to a generic default change for other fields", () => {
    const withDefault = (value: string) => ({
      parameters: [{ name: "locale", in: "query", schema: { type: "string", default: value } }],
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/l": { get: withDefault("en") } });
    const after = doc({ "/l": { get: withDefault("en-US") } });
    expect(ids(diffDocuments(before, after))).toContain("default.value-changed");
  });
});

describe("security", () => {
  it("flags a newly required scope, which no deploy can fix", () => {
    const secured = (scopes: string[]) => ({
      security: [{ oauth: scopes }],
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/p": { get: secured(["read"]) } });
    const after = doc({ "/p": { get: secured(["read", "write"]) } });

    const hits = only(diffDocuments(before, after), "security.scope-added");
    expect(hits[0].severity).toBe("BREAKING");
    expect(hits[0].detail).toBe("requires write");
  });
});

describe("$ref and composition handling", () => {
  it("follows internal refs into components", () => {
    const build = (props: Doc) =>
      doc(
        { "/r": { get: jsonOp({ $ref: "#/components/schemas/R" }) } },
        { schemas: { R: { type: "object", properties: props } } },
      );
    const before = build({ a: { type: "string" }, b: { type: "string" } });
    const after = build({ a: { type: "string" } });

    const hits = only(diffDocuments(before, after), "response.property.removed");
    expect(hits).toHaveLength(1);
    expect(hits[0].fieldPath).toBe("b");
  });

  it("terminates on a circular ref instead of hanging", () => {
    const build = (extra: Doc) =>
      doc(
        { "/c": { get: jsonOp({ $ref: "#/components/schemas/Charge" }) } },
        {
          schemas: {
            Charge: {
              type: "object",
              properties: { customer: { $ref: "#/components/schemas/Customer" }, ...extra },
            },
            Customer: {
              type: "object",
              properties: { charge: { $ref: "#/components/schemas/Charge" } },
            },
          },
        },
      );
    const result = diffDocuments(build({ note: { type: "string" } }), build({}));
    expect(only(result, "response.property.removed")[0].fieldPath).toBe("note");
  });

  it("flattens allOf so moving a field between members is not a false break", () => {
    const inline = doc({
      "/a": {
        get: jsonOp({
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
        }),
      },
    });
    const composed = doc({
      "/a": {
        get: jsonOp({
          allOf: [
            { type: "object", properties: { id: { type: "string" } } },
            { type: "object", properties: { name: { type: "string" } } },
          ],
        }),
      },
    });
    const result = diffDocuments(inline, composed);
    expect(ids(result)).not.toContain("response.property.removed");
  });
});

describe("relaxations are not breaks (found in real provider data)", () => {
  /**
   * Stripe's checkout ui_mode reported "no longer accepts custom, embedded,
   * form, hosted" — every value it had ever had. A provider never means that.
   * The enum keyword had simply been dropped, which widens what is accepted.
   */
  it("treats a dropped request enum as a widening, not a mass withdrawal", () => {
    const param = (schema: Doc) => ({
      parameters: [{ name: "ui_mode", in: "query", schema }],
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/c": { post: param({ type: "string", enum: ["hosted", "embedded"] }) } });
    const after = doc({ "/c": { post: param({ type: "string" }) } });

    const result = diffDocuments(before, after);
    expect(ids(result)).not.toContain("request.enum.value-removed");
    const hits = only(result, "request.enum.constraint-removed");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("ADDITIVE");
  });

  /** The mirror image, which was previously missed entirely. */
  it("treats a dropped response enum as breaking, since anything can now appear", () => {
    const before = doc({ "/c": { get: jsonOp({ type: "object", properties: { s: { type: "string", enum: ["a", "b"] } } }) } });
    const after = doc({ "/c": { get: jsonOp({ type: "object", properties: { s: { type: "string" } } }) } });

    const hits = only(diffDocuments(before, after), "response.enum.constraint-removed");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("BREAKING");
    expect(hits[0].directionFlip).toBe(true);
  });

  /**
   * GitHub's custom-property-value.value went string -> null|string and was
   * reported as a BREAKING request retype. On a request, accepting null where
   * you previously could not is purely a relaxation.
   */
  it("treats a request field gaining null as additive", () => {
    const body = (schema: Doc) => ({
      requestBody: { content: { "application/json": { schema: { type: "object", properties: { value: schema } } } } },
      responses: { "200": { description: "ok" } },
    });
    const before = doc({ "/p": { post: body({ type: "string" }) } });
    const after = doc({ "/p": { post: body({ type: "string", nullable: true }) } });

    const result = diffDocuments(before, after);
    expect(ids(result)).not.toContain("request.property.type-changed");
    const hits = only(result, "request.property.became-nullable");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("ADDITIVE");
  });

  it("but a response field gaining null is still a lost guarantee", () => {
    const before = doc({ "/p": { get: jsonOp({ type: "object", properties: { v: { type: "string" } } }) } });
    const after = doc({ "/p": { get: jsonOp({ type: "object", properties: { v: { type: "string", nullable: true } } }) } });
    expect(ids(diffDocuments(before, after))).toContain("response.property.became-optional");
  });
});

describe("schema repoints", () => {
  const build = (ref: string, shapes: Doc) =>
    doc({ "/r": { get: jsonOp({ type: "object", properties: { f: { $ref: ref } } }) } }, { schemas: shapes });

  it("calls an identical-shape repoint a rename, not a break", () => {
    const shape = { type: "object", properties: { a: { type: "string" } } };
    const before = build("#/components/schemas/OldName", { OldName: shape, NewName: shape });
    const after = build("#/components/schemas/NewName", { OldName: shape, NewName: shape });

    const hits = only(diffDocuments(before, after), "cosmetic.schema-renamed");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("COSMETIC");
    expect(hits[0].publishable).toBe(false);
  });

  it("holds a genuinely different repoint below the publish threshold", () => {
    const before = build("#/components/schemas/A", {
      A: { type: "object", properties: { a: { type: "string" } } },
      B: { type: "object", properties: { b: { type: "integer" } } },
    });
    const after = build("#/components/schemas/B", {
      A: { type: "object", properties: { a: { type: "string" } } },
      B: { type: "object", properties: { b: { type: "integer" } } },
    });

    const hits = only(diffDocuments(before, after), "schema.ref-retargeted");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("BEHAVIORAL");
    // Ambiguous by nature, so it is stored but never auto-published.
    expect(hits[0].publishable).toBe(false);
  });
});

describe("fingerprints are storable", () => {
  /**
   * Regression. The separator used to be NUL, which is the one byte Postgres
   * refuses in a text column, so every insert failed with
   * "invalid byte sequence for encoding UTF8: 0x00" and no change was ever
   * persisted. Unit tests passed the whole time, because nothing here touched
   * a database.
   */
  it("contain no control characters", () => {
    const before = doc({ "/a": { get: jsonOp({ type: "object", properties: { x: { type: "string" } } }) } });
    const after = doc({ "/a": { get: jsonOp({ type: "object", properties: {} }) } });
    const result = diffDocuments(before, after);

    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) {
      expect(change.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("still distinguish different facts and match identical ones", () => {
    const base = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } };
    const dropA = { type: "object", properties: { b: { type: "string" } } };
    const dropB = { type: "object", properties: { a: { type: "string" } } };

    const fpFor = (after: Doc) =>
      diffDocuments(
        doc({ "/x": { get: jsonOp(base) } }),
        doc({ "/x": { get: jsonOp(after) } }),
      ).changes[0]!.fingerprint;

    expect(fpFor(dropA)).not.toBe(fpFor(dropB));
    expect(fpFor(dropA)).toBe(fpFor(structuredClone(dropA)));
  });
});

describe("classification", () => {
  it("counts by severity and marks cosmetic changes unpublishable", () => {
    const before = doc({ "/a": { get: jsonOp({ type: "object", properties: { x: { type: "string" } } }) } });
    const after = doc({
      "/a": { get: jsonOp({ type: "object", properties: { x: { type: "integer" } } }) },
      "/b": { get: jsonOp({}) },
    });
    const result = diffDocuments(before, after);
    expect(result.counts.BREAKING).toBeGreaterThan(0);
    expect(result.counts.ADDITIVE).toBeGreaterThan(0);
    expect(result.changes.every((c) => typeof c.publishable === "boolean")).toBe(true);
  });

  it("is deterministic across runs", () => {
    const before = doc({ "/a": { get: jsonOp({ type: "object", required: ["x"], properties: { x: { type: "string" }, y: { type: "string" } } }) } });
    const after = doc({ "/a": { get: jsonOp({ type: "object", properties: { x: { type: "string" } } }) } });
    expect(JSON.stringify(diffDocuments(before, after))).toBe(
      JSON.stringify(diffDocuments(before, after)),
    );
  });
});
