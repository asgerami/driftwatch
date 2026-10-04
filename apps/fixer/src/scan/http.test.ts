import { describe, expect, it } from "vitest";

import { parse, scanHttp } from "./http.js";
import type { Targets } from "../targets.js";

const targets: Targets = {
  operations: [{ method: "POST", path: "/v1/customers" }],
  hosts: ["api.stripe.com"],
  basePaths: [],
  responseFields: [],
  requestFields: [],
  byFact: [],
};
const why = () => "test";
const found = (code: string) => scanHttp(parse("x.ts", code), targets, why).map((f) => f.confidence);

describe("raw HTTP matching", () => {
  it("resolves an object-literal constant's property as a base URL", () => {
    expect(found(`const cfg = { base: "https://api.stripe.com" };\nfetch(cfg.base + "/v1/customers", { method: "POST" });`)).toEqual(["high"]);
  });

  it("resolves new URL(path, base)", () => {
    expect(found(`fetch(new URL("/v1/customers", "https://api.stripe.com"), { method: "POST" });`)).toEqual(["high"]);
  });

  it("does not match a different HTTP method", () => {
    expect(found(`fetch("https://api.stripe.com/v1/customers");`)).toEqual([]);
  });

  it("lowers confidence when the method is dynamic", () => {
    expect(found(`fetch("https://api.stripe.com/v1/customers", { method: verb });`)).toEqual(["medium"]);
  });

  it("does not match a longer path that merely contains the operation", () => {
    expect(found(`fetch("https://api.stripe.com/v1/customers/search", { method: "POST" });`)).toEqual([]);
  });

  it("never matches a call with no literal path segment", () => {
    expect(found(`fetch(\`\${base}/\${resource}\`, { method: "POST" });`)).toEqual([]);
  });
});
