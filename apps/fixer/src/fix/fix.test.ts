import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadChange } from "../change.js";
import { FIXTURES } from "../eval.js";
import { loadSpec, loadSpecBefore } from "../spec.js";
import { fix, type FixResult } from "./index.js";

/**
 * M4 acceptance: every generated patch typechecks against its fixture repo.
 * Each fixture is a real published change, its specs cut down from the real
 * ones (scripts/trim-spec.ts), and a repo whose tsconfig and type stubs make
 * the typecheck mean something.
 */

const FIXED = ["stripe-payment-intents", "plaid-protect", "cloudflare-hyperdrive", "pagerduty-override"];

async function run(name: string): Promise<FixResult> {
  const dir = join(FIXTURES, name);
  const change = await loadChange(join(dir, "change.json"));
  const [after, before] = await Promise.all([
    loadSpec(change, join(dir, "spec.json")),
    loadSpecBefore(change, join(dir, "spec.before.json")),
  ]);
  return fix(change, after, before, join(dir, "repo"));
}

const results = new Map<string, Promise<FixResult>>();
const result = (name: string) => {
  if (!results.has(name)) results.set(name, run(name));
  return results.get(name)!;
};

describe("fix against the fixture repos", () => {
  for (const name of FIXED) {
    it(`${name}: the patch is the expected one, and the repo typechecks after it`, async () => {
      const r = await result(name);
      expect(r.diff).toBe(readFileSync(join(FIXTURES, name, "expected.patch"), "utf8"));
      expect(r.typecheck?.introduced).toEqual([]);
      expect(r.typecheck?.errors).toBe(0);
      expect(r.typecheck?.unresolvedModules).toEqual([]);
    });
  }

  it.skipIf(!existsSync("/usr/bin/git") && !existsSync("/usr/local/bin/git"))("every diff applies with git apply", async () => {
    for (const name of FIXED) {
      const r = await result(name);
      const dir = mkdtempSync(join(tmpdir(), "driftwatch-fix-"));
      try {
        cpSync(join(FIXTURES, name, "repo"), dir, { recursive: true });
        writeFileSync(join(dir, "fix.patch"), r.diff);
        execFileSync("git", ["apply", "fix.patch"], { cwd: dir });
        for (const [file, text] of Object.entries(r.files)) expect(readFileSync(join(dir, file), "utf8")).toBe(text);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("renames a field the specs show was renamed, in every form the code sends it", async () => {
    // Plaid: protect_session_id → device_session_id, as a key, a shorthand
    // property, and a quoted key nested in the event.
    const r = await result("plaid-protect");
    expect(r.patches.map((p) => [p.line, p.kind])).toEqual([
      [8, "rename"],
      [13, "rename"],
      [22, "rename"],
    ]);
    expect(r.typecheck?.baselineErrors).toBe(2); // the stubs are the renamed SDK
  });

  it("drops a rename the repo's own types would reject, and says why", async () => {
    const r = await result("cloudflare-hyperdrive");
    expect(r.patches.map((p) => p.line)).toEqual([7, 13]);
    expect(r.dropped.map((d) => d.patch.line)).toEqual([27]);
    expect(r.dropped[0]!.errors[0]).toContain("Property 'provider' does not exist");
  });

  it("adds a newly required field only with the value the new spec documents", async () => {
    const r = await result("pagerduty-override");
    expect(r.patches.map((p) => [p.line, p.kind, p.field])).toEqual([
      [19, "add", "override.type"],
      [29, "add", "override.type"],
    ]);
    expect(r.skipped.map((s) => [s.finding.line, s.reason])).toEqual([[41, "the call passes no object literal to add the field to"]]);
  });

  it("reports a newly required field with no documented value only where the call leaves it out", async () => {
    // Real case: OpenAI's image `model` became required with no default left.
    // hyperframe-studio sends `model: model || "dall-e-3"` and was reported anyway.
    const r = await result("openai-images");
    expect(r.patches).toEqual([]);
    expect(r.skipped.map((s) => [s.finding.line, s.reason])).toEqual([
      [25, "`model` is now required and the spec documents no single value for it"],
    ]);
  });

  it("removes an optional field, but not one with a possible replacement or a computed value", async () => {
    const r = await result("stripe-payment-intents");
    expect(r.patches.map((p) => [p.file, p.line, p.kind])).toEqual([
      ["src/billing.ts", 6, "remove"],
      ["src/billing.ts", 10, "remove"],
      ["src/billing.ts", 48, "remove"],
      ["src/routes/intents.ts", 5, "remove"], // through a client made in src/lib/stripe.ts
    ]);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.finding.line, s.reason]));
    expect(reasons[58]).toContain("computed by a call");
    expect(reasons[65]).toContain("`allowed_payment_method_types` appeared beside it");
  });
});
