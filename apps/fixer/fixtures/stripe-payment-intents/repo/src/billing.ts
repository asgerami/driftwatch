import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_KEY!, { apiVersion: "2026-09-23" });

export async function charge(amount: number) {
  return stripe.paymentIntents.create({ amount, currency: "usd", payment_method_types: ["card"] }); // driftwatch-expect: sdk
}

export async function changeMethods(id: string) {
  return stripe.paymentIntents.update(id, { payment_method_types: ["card"] }); // driftwatch-expect: sdk
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
