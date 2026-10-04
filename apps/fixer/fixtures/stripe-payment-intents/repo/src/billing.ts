import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_KEY!, { apiVersion: "2026-09-23" });

export async function charge(amount: number) {
  return stripe.paymentIntents.create({ amount, currency: "usd", payment_method_types: ["card"] }); // driftwatch-expect: sdk, field
}

export async function changeMethods(id: string) {
  return stripe.paymentIntents.update(id, { payment_method_types: ["card"] }); // driftwatch-expect: sdk, field
}

export async function confirm(id: string) {
  return stripe.paymentIntents.confirm(id); // driftwatch-expect: sdk
}

// Not affected: same resource, other operations; another resource.
export async function read(id: string) {
  return stripe.paymentIntents.retrieve(id);
}
export async function recent() {
  return stripe.paymentIntents.list({ limit: 3 });
}
export async function signUp(email: string) {
  return stripe.customers.create({ email });
}

export class Checkout {
  constructor(private readonly client: Stripe) {}

  start(amount: number) {
    return this.client.paymentIntents.create({ amount, currency: "eur" }); // driftwatch-expect: sdk
  }
}

// Not Stripe: a local object with the same shape.
const store = { paymentIntents: { create: (input: unknown) => input } };
export const local = store.paymentIntents.create({ amount: 1 });

function methodsFor(country: string): string[] {
  return country === "NL" ? ["card", "ideal"] : ["card"];
}

// Patched across lines, in the literal's own layout.
export async function subscribe(amount: number) {
  return stripe.paymentIntents.create({ // driftwatch-expect: sdk
    amount,
    payment_method_types: ["card", "sepa_debit"], // driftwatch-expect: field
    currency: "eur",
  });
}

// Not patched: the value comes from a call, which deleting would drop.
export async function localized(amount: number, country: string) {
  return stripe.paymentIntents.create({ // driftwatch-expect: sdk
    amount,
    currency: "eur",
    payment_method_types: methodsFor(country), // driftwatch-expect: field
  });
}

// Not patched: Checkout gained allowed_payment_method_types in the same
// release, the same shape, described as a filter rather than a list.
export async function checkout(price: string) {
  return stripe.checkout.sessions.create({ mode: "payment", line_items: [{ price, quantity: 1 }], payment_method_types: ["card"] }); // driftwatch-expect: sdk, field
}
