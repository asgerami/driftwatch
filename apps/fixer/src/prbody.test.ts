import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadChange } from "./change.js";
import { FIXTURES } from "./eval.js";
import { fix } from "./fix/index.js";
import { prBody, type FixReport } from "./prbody.js";
import { loadSpec, loadSpecBefore } from "./spec.js";

async function report(name: string): Promise<FixReport> {
  const dir = join(FIXTURES, name);
  const change = await loadChange(join(dir, "change.json"));
  const [after, before] = await Promise.all([loadSpec(change, join(dir, "spec.json")), loadSpecBefore(change, join(dir, "spec.before.json"))]);
  const { files: _files, ...rest } = await fix(change, after, before, join(dir, "repo"));
  return { ...rest, tests: null };
}

describe("pr-body", () => {
  it("has the brief's four parts, in order, and links the change and the spec diff", async () => {
    const { title, body } = prBody(await report("plaid-protect"));
    expect(title).toBe("Rename `protect_session_id` to `device_session_id`, after Plaid's API change");
    const order = ["### What changed upstream", "### What this PR changes", "### How it was verified", "Found by [Driftwatch]"].map((h) => body.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain("https://driftwatch.et/changes/plaid-2026-09-01-31912bc8");
    expect(body).toContain("https://github.com/plaid/plaid-openapi/compare/82f90e96796e...7d1446fa4c6f");
    expect(body).toContain("no new errors (2 before, 0 after)");
  });

  it("discloses Driftwatch in exactly one line, and nothing else", async () => {
    const { body } = prBody(await report("plaid-protect"));
    expect(body.split("\n").filter((l) => /driftwatch/i.test(l) && !/driftwatch\.et\/(changes|method)/.test(l))).toHaveLength(1);
    expect(body).not.toMatch(/claude|generated with|co-authored/i);
  });

  it("quotes what the provider said a removed field did, and asks for a check", async () => {
    const { title, body } = prBody(await report("stripe-payment-intents"));
    expect(title).toBe("Stop sending `payment_method_types`, which Stripe no longer accepts");
    expect(body).toContain("> The list of payment method types (for example, a card) that this PaymentIntent can use. If you don't provide this");
    expect(body).toContain("Please check that is what you want.");
    expect(body).toContain("`allowed_payment_method_types` appeared beside it");
  });

  it("names a nested rename by its full path, and lists a dropped patch", async () => {
    const { body } = prBody(await report("cloudflare-hyperdrive"));
    expect(body).toContain("renamed `integration.integration` to `integration.provider`");
    expect(body).toContain("would not typecheck: TS2339 Property 'provider' does not exist");
  });

  it("states the documented value it sends", async () => {
    const { title, body } = prBody(await report("pagerduty-override"));
    expect(title).toBe("Send `type`, which PagerDuty now requires");
    expect(body).toContain('Its spec documents one value for it, `"override_shift"`.');
  });

  it("refuses a fix with no patches", async () => {
    const r = await report("plaid-protect");
    expect(() => prBody({ ...r, patches: [] })).toThrow(/no patches/);
  });
});
