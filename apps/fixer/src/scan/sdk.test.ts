import { describe, expect, it } from "vitest";

import { camel, signaturesFor } from "./sdk.js";

const names = (method: string, path: string, operationId?: string) =>
  signaturesFor({ method, path, operationId }).map((s) => `${s.namespaces?.join(".") ?? "*"}.${s.method}`);

describe("SDK method names for an operation", () => {
  it("follow the REST shape Stripe's SDK uses", () => {
    expect(names("POST", "/v1/payment_intents")).toContain("paymentIntents.create");
    expect(names("GET", "/v1/payment_intents")).toContain("paymentIntents.list");
    expect(names("GET", "/v1/payment_intents/{intent}")).toContain("paymentIntents.retrieve");
    expect(names("POST", "/v1/payment_intents/{intent}")).toContain("paymentIntents.update");
    expect(names("DELETE", "/v1/customers/{customer}")).toContain("customers.del");
    expect(names("POST", "/v1/payment_intents/{intent}/confirm")).toContain("paymentIntents.confirm");
    expect(names("POST", "/v1/checkout/sessions")).toContain("checkout.sessions.create");
  });

  it("and OpenAI's", () => {
    expect(names("POST", "/chat/completions")).toContain("chat.completions.create");
    expect(names("GET", "/threads/{thread_id}/messages")).toContain("threads.messages.list");
  });

  it("use GitHub's operationId, which is Octokit's method name", () => {
    expect(names("GET", "/repos/{owner}/{repo}/contents/{path}", "repos/get-content")).toContain("repos.getContent");
  });

  it("use a flat operationId as the method on any namespace (Plaid, Square)", () => {
    expect(names("POST", "/link/token/create", "linkTokenCreate")).toContain("*.linkTokenCreate");
  });

  it("camel-case snake, kebab and leading capitals", () => {
    expect(camel("payment_intents")).toBe("paymentIntents");
    expect(camel("get-content")).toBe("getContent");
    expect(camel("CreatePayment")).toBe("createPayment");
  });
});
