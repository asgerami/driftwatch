import { describe, expect, it } from "vitest";

import { normalizeSpec } from "../normalize/index.js";
import { diffDocuments } from "./index.js";

/**
 * M1 acceptance: a refactor-only spec change creates no breaking items.
 *
 * Every edit below is one a real provider made without changing its API,
 * each of which once produced false breaks here: key and set reordering
 * (every generator), a renamed shared component with its $refs updated
 * (Stripe, constantly), the 3.0 → 3.1 spelling of "X or null" (OpenAI's
 * Upload.file), and reworded descriptions. Both sides go through the real
 * normalize-then-diff path, exactly as production runs it.
 */

const before = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1.0.0", description: "The pet API." },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List pets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "kind", in: "query", schema: { type: "string", enum: ["cat", "dog", "fish"] } },
        ],
        responses: {
          "200": {
            description: "Pets",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        description: "A pet.",
        required: ["id", "name", "kind"],
        properties: {
          id: { type: "string" },
          name: { type: "string", description: "Its name." },
          kind: { type: "string", enum: ["cat", "dog", "fish"] },
          owner: {
            allOf: [{ $ref: "#/components/schemas/Owner" }, { nullable: true, description: "Who owns it." }],
          },
        },
      },
      Owner: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, email: { type: "string" } },
      },
    },
  },
};

// The same API, refactored: keys and sets reordered, Pet renamed to Animal
// everywhere, owner's nullability spelled the 3.1 way, descriptions reworded.
const after = {
  components: {
    schemas: {
      Owner: {
        properties: { email: { type: "string" }, id: { type: "string" } },
        required: ["id"],
        type: "object",
      },
      Animal: {
        required: ["kind", "name", "id"],
        description: "An animal kept as a pet.",
        type: "object",
        properties: {
          owner: {
            anyOf: [{ $ref: "#/components/schemas/Owner" }, { type: "null" }],
            description: "The person who owns it.",
          },
          kind: { enum: ["fish", "dog", "cat"], type: "string" },
          name: { description: "What it is called.", type: "string" },
          id: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/pets": {
      get: {
        summary: "List all pets",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { items: { $ref: "#/components/schemas/Animal" }, type: "array" },
              },
            },
            description: "A list of pets",
          },
        },
        parameters: [
          { in: "query", schema: { enum: ["dog", "fish", "cat"], type: "string" }, name: "kind" },
          { schema: { default: 20, type: "integer" }, in: "query", name: "limit" },
        ],
        operationId: "listPets",
      },
    },
  },
  info: { version: "1.0.0", description: "Pets, as an API.", title: "Pets" },
  openapi: "3.1.0",
};

describe("a refactor-only spec change", () => {
  it("creates no publishable change at all", async () => {
    const [a, b] = await Promise.all([
      normalizeSpec(JSON.stringify(before)),
      normalizeSpec(JSON.stringify(after)),
    ]);
    const result = diffDocuments(a.document, b.document);

    expect(result.counts.BREAKING).toBe(0);
    expect(result.changes.filter((change) => change.publishable)).toEqual([]);
    // The rename is recorded and held below the publish threshold. It is not
    // the cosmetic rename rule because the description was reworded too, and
    // targets are compared as written.
    expect(result.changes.map((change) => change.ruleId)).toEqual(["schema.ref-retargeted"]);
  });

  it("still catches a real break in the same spec (control)", async () => {
    // Drop a required field without renaming anything: that must break.
    const broken = structuredClone(before);
    delete (broken.components.schemas.Pet.properties as Record<string, unknown>)["name"];
    const [a, b] = await Promise.all([
      normalizeSpec(JSON.stringify(before)),
      normalizeSpec(JSON.stringify(broken)),
    ]);
    expect(diffDocuments(a.document, b.document).counts.BREAKING).toBeGreaterThan(0);
  });

  it("KNOWN GAP: a break hidden behind a component rename is held, not reported", async () => {
    // Pet renamed to Animal AND `name` removed in the same release. Components
    // are diffed by name, so Pet and Animal are never compared; the repoint is
    // schema.ref-retargeted at 80, held, and the removal goes unreported. No
    // false alarm, but a missed break. Fixing it means diffing the old and new
    // targets at the repoint: a ruleset change. When that lands, this test
    // flips to expect BREAKING.
    const renamedAndBroken = structuredClone(after);
    delete (renamedAndBroken.components.schemas.Animal.properties as Record<string, unknown>)["name"];
    const [a, b] = await Promise.all([
      normalizeSpec(JSON.stringify(before)),
      normalizeSpec(JSON.stringify(renamedAndBroken)),
    ]);
    const result = diffDocuments(a.document, b.document);
    expect(result.counts.BREAKING).toBe(0);
    expect(result.changes.map((change) => change.ruleId)).toEqual(["schema.ref-retargeted"]);
  });
});
