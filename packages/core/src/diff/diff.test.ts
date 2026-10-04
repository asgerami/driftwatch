import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { diffDocuments, fingerprintOf } from "./index.js";
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

  it("also fires when a required response field merely becomes nullable", () => {
    // Real case: OpenAI EvalRun.model, required, string → string|null (2026-09-29).
    const before = doc({ "/u": { get: jsonOp({ type: "object", required: ["name"], properties: { name: { type: "string" } } }) } });
    const after = doc({ "/u": { get: jsonOp({ type: "object", required: ["name"], properties: { name: { type: "string", nullable: true } } }) } });

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

describe("a removed required response field is one fact", () => {
  it("reports the removal, not also the lost guarantee", () => {
    // Real case: Cloudflare hyperdrive-planet-scale-integration renamed its
    // required `integration` to `provider` (555ecf93 → 4b304627).
    const shape = (props: Doc, required: string[]) => ({ type: "object", required, properties: props });
    const before = doc({ "/h": { get: jsonOp(shape({ integration: { type: "string" }, scheme: { type: "string" } }, ["integration", "scheme"])) } });
    const after = doc({ "/h": { get: jsonOp(shape({ provider: { type: "string" }, scheme: { type: "string" } }, ["provider", "scheme"])) } });
    const result = diffDocuments(before, after);
    expect(ids(result).sort()).toEqual(["response.property.added", "response.property.removed"]);
  });

  it("still flags a field that stays but stops being required", () => {
    const shape = (required: string[]) => ({ type: "object", required, properties: { a: { type: "string" } } });
    const result = diffDocuments(doc({ "/h": { get: jsonOp(shape(["a"])) } }), doc({ "/h": { get: jsonOp(shape([])) } }));
    expect(ids(result)).toEqual(["response.property.became-optional"]);
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
  const secured = (security: Doc[]) => doc({ "/r": { get: jsonOp({}, { security }) } });
  const run = (before: Doc[], after: Doc[]) => diffDocuments(secured(before), secured(after));

  it("flags a newly required scope, which no deploy can fix", () => {
    const result = run([{ oauth: ["repo"] }], [{ oauth: ["repo", "admin:org"] }]);
    expect(ids(result)).toEqual(["security.scope-added"]);
    expect(result.changes[0]?.detail).toBe("requires admin:org");
  });

  it("flags a swapped scheme once, not as changed plus removed", () => {
    const result = run([{ basicAuth: [] }], [{ bearerAuth: [] }]);
    expect(ids(result)).toEqual(["security.scheme-changed"]);
    expect(result.changes[0]?.severity).toBe("BREAKING");
    expect(result.changes[0]?.detail).toBe("basicAuth → bearerAuth");
  });

  it("does not call a new ALTERNATIVE a break: any one alternative is enough", () => {
    // Regression: alternatives were flattened into one map, so "you may now
    // also use an API key" read as "authentication scheme changed".
    const result = run([{ oauth: ["repo"] }], [{ oauth: ["repo"] }, { apiKey: [] }]);
    expect(result.changes).toEqual([]);
  });

  it("does not call extra scopes on a new alternative a break", () => {
    const result = run([{ oauth: ["repo"] }], [{ oauth: ["repo"] }, { oauth: ["admin"] }]);
    expect(result.changes).toEqual([]);
  });

  it("flags removing the alternative a caller may be using", () => {
    const result = run([{ oauth: [] }, { apiKey: [] }], [{ oauth: [] }]);
    expect(ids(result)).toEqual(["security.scheme-changed"]);
    expect(result.changes[0]?.before).toBe("apiKey");
  });

  it("treats a dropped credential as a relaxation held below the threshold", () => {
    // Both were required together; now one is enough.
    const result = run([{ oauth: [], apiKey: [] }], [{ oauth: [] }]);
    expect(ids(result)).toEqual(["security.requirement-removed"]);
    expect(result.changes[0]?.severity).toBe("BEHAVIORAL");
    expect(result.changes[0]?.publishable).toBe(false);
  });

  it("treats an operation made public as a relaxation", () => {
    expect(ids(run([{ oauth: [] }], []))).toEqual(["security.requirement-removed"]);
  });

  it("stays silent when security is documented for the first time", () => {
    const before = doc({ "/r": { get: jsonOp({}) } });
    expect(diffDocuments(before, secured([{ oauth: [] }])).changes).toEqual([]);
  });
});

describe("rules without earlier coverage", () => {
  it("lifting a deprecation is additive", () => {
    const before = doc({ "/a": { get: jsonOp({}, { deprecated: true }) } });
    const after = doc({ "/a": { get: jsonOp({}) } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toEqual(["operation.undeprecated"]);
    expect(result.changes[0]?.severity).toBe("ADDITIVE");
  });

  it("an optional parameter becoming required is breaking", () => {
    const param = (required: boolean) => ({
      name: "customer",
      in: "query",
      required,
      schema: { type: "string" },
    });
    const before = doc({ "/a": { get: jsonOp({}, { parameters: [param(false)] }) } });
    const after = doc({ "/a": { get: jsonOp({}, { parameters: [param(true)] }) } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toEqual(["request.param.became-required"]);
    expect(result.changes[0]?.fieldPath).toBe("customer");
    expect(result.changes[0]?.severity).toBe("BREAKING");
  });

  const body = (schema: Doc) =>
    doc({
      "/a": {
        post: {
          requestBody: { content: { "application/json": { schema } } },
          responses: { "200": { description: "ok" } },
        },
      },
    });

  it("a request body property becoming required is breaking", () => {
    // Real case: Stripe billing_cycle_anchor.type, 2026-09-23.
    const shape = (required: string[]) => ({
      type: "object",
      required,
      properties: { type: { type: "string" }, date: { type: "integer" } },
    });
    const result = diffDocuments(body(shape([])), body(shape(["type"])));
    expect(ids(result)).toEqual(["request.property.became-required"]);
    expect(result.changes[0]?.fieldPath).toBe("type");
  });

  it("a request body property no longer accepted is breaking, and a direction flip", () => {
    // Real case: Stripe POST /v1/terminal/refunds kept only `expand`, 2026-05-23.
    const before = body({ type: "object", properties: { amount: { type: "integer" }, expand: { type: "array" } } });
    const after = body({ type: "object", properties: { expand: { type: "array" } } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toEqual(["request.property.removed"]);
    expect(result.changes[0]?.fieldPath).toBe("amount");
    expect(result.changes[0]?.directionFlip).toBe(true);
  });

  it("a newly documented status code is behavioral", () => {
    // Real case: GitHub began documenting 503 on several operations.
    const before = doc({ "/a": { get: jsonOp({}) } });
    const after = doc({
      "/a": {
        get: {
          responses: {
            "200": { description: "ok", content: { "application/json": { schema: {} } } },
            "503": { description: "unavailable" },
          },
        },
      },
    });
    const result = diffDocuments(before, after);
    expect(ids(result)).toEqual(["response.status-code.added"]);
    expect(result.changes[0]?.detail).toBe("503 is now documented");
    expect(result.changes[0]?.severity).toBe("BEHAVIORAL");
  });

  it("a status code no longer documented is behavioral", () => {
    const before = doc({
      "/a": {
        get: {
          responses: {
            "200": { description: "ok" },
            "410": { description: "gone" },
          },
        },
      },
    });
    const after = doc({ "/a": { get: { responses: { "200": { description: "ok" } } } } });
    const result = diffDocuments(before, after);
    expect(ids(result)).toEqual(["response.status-code.removed"]);
    expect(result.changes[0]?.detail).toBe("410 no longer documented");
  });

  it("a new endpoint and a new verb are additive", () => {
    const before = doc({ "/a": { get: jsonOp({}) } });
    const after = doc({ "/a": { get: jsonOp({}), post: jsonOp({}) }, "/b": { get: jsonOp({}) } });
    const result = diffDocuments(before, after);
    expect(ids(result).sort()).toEqual(["operation.added", "path.added"]);
    expect(result.changes.every((c) => c.severity === "ADDITIVE")).toBe(true);
  });

  it("new optional request and response fields are additive", () => {
    const op = (props: Doc) => ({
      requestBody: { content: { "application/json": { schema: { type: "object", properties: props } } } },
      responses: {
        "200": {
          description: "ok",
          content: { "application/json": { schema: { type: "object", properties: props } } },
        },
      },
    });
    const before = doc({ "/a": { post: op({ id: { type: "string" } }) } });
    const after = doc({ "/a": { post: op({ id: { type: "string" }, note: { type: "string" } }) } });
    const result = diffDocuments(before, after);
    expect(ids(result).sort()).toEqual(["request.property.added", "response.property.added"]);
    expect(result.changes.every((c) => c.severity === "ADDITIVE")).toBe(true);
  });

  it("an edit to description text alone produces nothing at all", () => {
    const schema = (description: string) => ({
      type: "object",
      description,
      properties: { id: { type: "string", description } },
    });
    const before = doc({ "/a": { get: jsonOp(schema("The id."), { summary: "Get it", description: "Old." }) } });
    const after = doc({ "/a": { get: jsonOp(schema("The identifier."), { summary: "Fetch it", description: "New." }) } });
    expect(diffDocuments(before, after).changes).toEqual([]);
  });
});

describe("every rule in the catalog", () => {
  it("is exercised by at least one test in this file", async () => {
    // A rule listed on /method that no test fires is a claim nobody checks.
    // cosmetic.description-changed sat in the catalog for months, emitted by
    // nothing, while /method told readers description edits were stored.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./diff.test.ts", import.meta.url), "utf8");
    const { RULES } = await import("./rules.js");
    const unexercised = Object.keys(RULES).filter((id) => !source.includes(`"${id}"`));
    expect(unexercised).toEqual([]);
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

  it("but a required response field gaining null is still a lost guarantee", () => {
    const before = doc({ "/p": { get: jsonOp({ type: "object", required: ["v"], properties: { v: { type: "string" } } }) } });
    const after = doc({ "/p": { get: jsonOp({ type: "object", required: ["v"], properties: { v: { type: "string", nullable: true } } }) } });
    expect(ids(diffDocuments(before, after))).toContain("response.property.became-optional");
  });

  it("an OPTIONAL response field gaining null is held for review, not published", () => {
    // Real case: Square's move from Swagger 2.0 to OpenAPI 3.0 (9bb37051,
    // 2024-11-07) annotated 1759 fields nullable, 6 of them required. The
    // optional ones never guaranteed a value, so callers already handle absence.
    const shape = (nullable: boolean) => ({
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        account_number_suffix: { type: "string", ...(nullable ? { nullable: true } : {}) },
      },
    });
    const result = diffDocuments(
      doc({ "/p": { get: jsonOp(shape(false)) } }),
      doc({ "/p": { get: jsonOp(shape(true)) } }),
    );
    expect(ids(result)).toEqual(["response.property.optional-now-nullable"]);
    expect(result.changes[0]?.severity).toBe("BEHAVIORAL");
    expect(result.changes[0]?.publishable).toBe(false);
  });

  it("items of an array gaining null are still a lost guarantee", () => {
    const list = (nullable: boolean) => ({
      type: "object",
      required: ["data"],
      properties: { data: { type: "array", items: { type: "string", ...(nullable ? { nullable: true } : {}) } } },
    });
    const result = diffDocuments(doc({ "/p": { get: jsonOp(list(false)) } }), doc({ "/p": { get: jsonOp(list(true)) } }));
    expect(ids(result)).toEqual(["response.property.became-optional"]);
  });
});

describe("nullable spellings are the same schema", () => {
  // Real case: openai/openai-openapi 7140eb70 → 4399577e rewrote Upload.file
  // from the OAS 3.0 spelling to the 3.1 one. Same meaning, but it was
  // reported as every OpenAIFile field removed AND no longer guaranteed.
  const components = (file: Doc) => ({
    schemas: {
      OpenAIFile: {
        type: "object",
        required: ["id", "bytes", "filename"],
        properties: {
          id: { type: "string" },
          bytes: { type: "integer" },
          filename: { type: "string" },
        },
      },
      Upload: {
        type: "object",
        required: ["id", "file"],
        properties: { id: { type: "string" }, file },
      },
    },
  });
  const paths = {
    "/uploads/{id}": { get: jsonOp({ $ref: "#/components/schemas/Upload" }) },
  };
  const ref = { $ref: "#/components/schemas/OpenAIFile" };
  const oas30 = {
    allOf: [ref, { nullable: true, description: "The ready File object." }],
  };

  for (const keyword of ["anyOf", "oneOf"] as const) {
    it(`treats allOf+nullable and ${keyword} with a null arm as identical`, () => {
      const oas31 = {
        description: "The ready File object.",
        [keyword]: [ref, { type: "null" }],
      };
      const forward = diffDocuments(doc(paths, components(oas30)), doc(paths, components(oas31)));
      const back = diffDocuments(doc(paths, components(oas31)), doc(paths, components(oas30)));
      expect(forward.changes).toEqual([]);
      expect(back.changes).toEqual([]);
    });
  }

  it("still catches a wrapped field gaining null on a response", () => {
    const nonNull = { allOf: [ref] };
    const nullable = { anyOf: [ref, { type: "null" }] };
    const result = diffDocuments(doc(paths, components(nonNull)), doc(paths, components(nullable)));
    expect(ids(result)).toEqual(["response.property.became-optional"]);
    expect(result.changes[0]?.fieldPath).toBe("file");
  });

  it("still sees a real change inside the nullable wrapper", () => {
    const before = components(oas30);
    const after = components({ anyOf: [ref, { type: "null" }] });
    after.schemas.OpenAIFile.required = ["id", "bytes"];
    const result = diffDocuments(doc(paths, before), doc(paths, after));
    const hits = only(result, "response.property.became-optional");
    expect(hits.map((h) => h.fieldPath)).toContain("filename");
    expect(ids(result)).not.toContain("response.property.removed");
  });

  it("reports a union gaining a variant once, not as every field removed", () => {
    // Real case: FineTuningJob.error, X | null → X | null | {} (9654de53 → 883357cf).
    const before = components({ anyOf: [ref, { type: "null" }] });
    const after = components({ anyOf: [ref, { type: "null" }, { type: "object", maxProperties: 0 }] });
    expect(ids(diffDocuments(doc(paths, before), doc(paths, after)))).toEqual([
      "schema.composition-changed",
    ]);
  });

  it("leaves a genuine two-schema union alone", () => {
    const union = (arms: Doc[]) => components({ anyOf: arms });
    const before = union([ref, { type: "string" }]);
    const after = union([ref, { type: "string" }, { type: "integer" }]);
    expect(ids(diffDocuments(doc(paths, before), doc(paths, after)))).toContain(
      "schema.composition-changed",
    );
  });
});

describe("a response narrowing its type is not a break", () => {
  const field = (schema: Doc) =>
    doc({ "/list": { get: jsonOp({ type: "object", properties: { first_id: schema } }) } });

  it("treats null|string → string on a response as a tighter guarantee", () => {
    // Real case: OpenAI ChatCompletionList.first_id, 2026-09-28.
    const result = diffDocuments(
      field({ type: ["string", "null"] }),
      field({ type: "string" }),
    );
    expect(ids(result)).toEqual(["response.property.type-narrowed"]);
    expect(result.changes[0]?.severity).toBe("ADDITIVE");
  });

  it("also for the OAS 3.0 nullable spelling", () => {
    // Real case: Stripe expected_debit_date, 2026-02-23.
    const result = diffDocuments(
      field({ type: "string", nullable: true }),
      field({ type: "string" }),
    );
    expect(ids(result)).toEqual(["response.property.type-narrowed"]);
  });

  it("holds a field narrowed to always-null below the publish threshold", () => {
    // Real case: Twilio messaging.v1 rate_limits, null|object → null.
    const result = diffDocuments(
      field({ type: ["object", "null"] }),
      field({ type: "null" }),
    );
    expect(ids(result)).toEqual(["response.property.now-always-null"]);
    expect(result.changes[0]?.severity).toBe("BEHAVIORAL");
    expect(result.changes[0]?.publishable).toBe(false);
  });

  it("still calls a request that stops accepting null a break", () => {
    const body = (schema: Doc) =>
      doc({
        "/x": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { v: schema } },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      });
    const result = diffDocuments(body({ type: ["string", "null"] }), body({ type: "string" }));
    expect(ids(result)).toEqual(["request.property.type-changed"]);
    expect(result.changes[0]?.severity).toBe("BREAKING");
  });

  it("still calls a genuine response retype a break", () => {
    const result = diffDocuments(field({ type: "string" }), field({ type: "integer" }));
    expect(ids(result)).toEqual(["response.property.type-changed"]);
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

  it("give each removed endpoint its own fingerprint", () => {
    // Regression: GitHub's 11 moved enterprise endpoints were "1 distinct fact".
    const before = doc({ "/a": { get: jsonOp({}) }, "/b": { get: jsonOp({}) } });
    const removed = only(diffDocuments(before, doc({})), "path.removed");
    expect(removed).toHaveLength(2);
    expect(removed[0].fingerprint).not.toBe(removed[1].fingerprint);

    const ops = doc({ "/a": { get: jsonOp({}), post: jsonOp({}), put: jsonOp({}) } });
    const dropped = only(
      diffDocuments(ops, doc({ "/a": { get: jsonOp({}) } })),
      "operation.removed",
    );
    expect(new Set(dropped.map((c) => c.fingerprint)).size).toBe(2);
  });

  it("leave every other rule's fingerprint exactly as it was", () => {
    // Stored decisions are carried forward by fingerprint, so a fingerprint
    // that silently changes would unpublish the feed on the next bump. The
    // value is the pre-1.3.0 formula over the same parts.
    const change = {
      ruleId: "response.property.removed",
      componentName: "charge",
      fieldPath: "customer.address",
      before: "address",
      method: "get",
      path: "/v1/charges",
    } as const;
    const old = createHash("sha256")
      .update(
        ["response.property.removed", "charge", "customer.address", '"address"', "null", ""].join(
          "\u001f",
        ),
        "utf8",
      )
      .digest("hex");
    expect(fingerprintOf(change as never)).toBe(old);
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
