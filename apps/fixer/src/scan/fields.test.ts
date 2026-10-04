import { describe, expect, it } from "vitest";

import type { MatchedCall } from "../findings.js";
import type { Targets } from "../targets.js";
import { scanFields } from "./fields.js";
import { parse, scanHttp } from "./http.js";

const op = "GET /v1/customers/{customer}";
const targets = (path: string[]): Targets => ({
  operations: [{ method: "GET", path: "/v1/customers/{customer}" }],
  hosts: ["api.stripe.com"],
  basePaths: [],
  responseFields: [{ path, operations: [op], absolute: {} }],
  requestFields: [],
  byFact: [],
});
const why = () => "test";

/** Field findings in one file, as "line:confidence". */
function fields(code: string, path = ["tax_ids"]): string[] {
  const source = parse("x.ts", code);
  const matched: MatchedCall[] = [];
  const t = targets(path);
  scanHttp(source, t, why, matched);
  return scanFields([source], matched, t, why).map((f) => `${f.line}:${f.confidence}`);
}

const call = `const res = await fetch("https://api.stripe.com/v1/customers/cus_1");\nconst body = await res.json();\n`;

describe("field access", () => {
  it("is high when the path read from the body is the fact's field path", () => {
    expect(fields(`${call}body.tax_ids;`)).toEqual(["3:high"]);
  });

  it("is medium when only the field's name matches", () => {
    // The fact sits under a shared component reached at some other depth.
    expect(fields(`${call}body.invoice_settings.tax_ids;`)).toEqual(["3:medium"]);
  });

  it("is medium when the call itself was only a medium match", () => {
    const code = `const res = await fetch(\`\${process.env.BASE}/v1/customers/cus_1\`);\nconst body = await res.json();\nbody.tax_ids;`;
    expect(fields(code)).toEqual(["3:medium"]);
  });

  it("does not take the Response object for the body", () => {
    // fetch's Response has to go through .json() first.
    expect(fields(`const res = await fetch("https://api.stripe.com/v1/customers/cus_1");\nres.tax_ids;`)).toEqual([]);
  });

  it("guesses at a parameter's read, but never at a local from another call", () => {
    const code = `${call}export function show(c: { tax_ids: string[] }) { return c.tax_ids; }\nconst other = await fetch("https://example.com/x");\nconst o = await other.json();\no.tax_ids;`;
    expect(fields(code)).toEqual(["3:low"]);
  });

  it("does not guess at generic names", () => {
    const code = `${call}export function show(c: { email: string }) { return c.email; }`;
    expect(fields(code, ["email"])).toEqual([]);
  });

  it("finds a request field in the payload, through JSON.stringify and a const", () => {
    const source = parse(
      "x.ts",
      `const payload = { tax_ids: [] };\nfetch("https://api.stripe.com/v1/customers/cus_1", { method: "POST", body: JSON.stringify(payload) });\nfetch("https://api.stripe.com/v1/customers/cus_1", {\n  method: "POST",\n  body: JSON.stringify({ tax_ids: [] }),\n});`,
    );
    const t: Targets = {
      operations: [{ method: "POST", path: "/v1/customers/{customer}" }],
      hosts: ["api.stripe.com"],
      basePaths: [],
      responseFields: [],
      requestFields: [{ path: ["tax_ids"], operations: ["POST /v1/customers/{customer}"], absolute: {} }],
      byFact: [],
    };
    const matched: MatchedCall[] = [];
    scanHttp(source, t, why, matched);
    expect(scanFields([source], matched, t, why).map((f) => `${f.line}:${f.confidence}`)).toEqual(["1:high", "5:high"]);
  });
});
