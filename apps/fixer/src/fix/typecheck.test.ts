import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { typecheck } from "./typecheck.js";

const repo = mkdtempSync(join(tmpdir(), "driftwatch-js-"));
writeFileSync(join(repo, "route.js"), "export const body = { a: 1, b: 2 };\n");
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("typecheck on a JavaScript-only repo", () => {
  it("says it typechecked nothing, and parsed the patched file instead", () => {
    const r = typecheck(repo, new Map([[join(repo, "route.js"), "export const body = { a: 1 };\n"]]));
    expect([r.filesChecked, r.syntaxChecked, r.introduced]).toEqual([0, 1, []]);
  });

  it("still catches a patch that breaks the syntax", () => {
    const r = typecheck(repo, new Map([[join(repo, "route.js"), "export const body = { a: 1, };;}\n"]]));
    expect(r.introduced.length).toBeGreaterThan(0);
  });
});
