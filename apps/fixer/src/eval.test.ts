import { describe, expect, it } from "vitest";

import { evaluateAll, evaluateFixture } from "./eval.js";

/**
 * M4 acceptance: scan precision and recall, measured against the fixture
 * repos. Fixtures and specs are local; nothing here touches the network.
 */
describe("scan against the fixture repos", () => {
  it("finds every marked raw HTTP and SDK call, and nothing else", async () => {
    const { total, fixtures } = await evaluateAll();
    for (const fixture of fixtures) {
      expect({ name: fixture.name, missed: fixture.missed, unexpected: fixture.unexpected }).toEqual({
        name: fixture.name,
        missed: [],
        unexpected: [],
      });
    }
    for (const kind of ["http", "sdk"]) {
      expect({ kind, precision: total[kind]?.precision, recall: total[kind]?.recall }).toEqual({ kind, precision: 1, recall: 1 });
    }
  });

  it("reaches a shared component's operations through the spec's usage index", async () => {
    // OpenAI: the change names only CreateChatCompletionResponse; the scan
    // must work out that POST /chat/completions returns it.
    const result = await evaluateFixture("openai-chat");
    expect(result.byKind["http"]?.truePositives).toBe(4);
  });
});
