import stripe, { getStripe, shared } from "../lib/stripe";

export async function later(amount: number) {
  const s = getStripe();
  return s.paymentIntents.create({ amount, currency: "usd", payment_method_types: ["card"] }); // driftwatch-expect: sdk, field
}

export async function confirmLater(id: string) {
  return stripe.paymentIntents.confirm(id); // driftwatch-expect: sdk
}

export async function touch(id: string) {
  return shared.paymentIntents.update(id); // driftwatch-expect: sdk
}

// Not a client: a local function with the same name as the shared one.
function initLocal() {
  return { paymentIntents: { create: (input: unknown) => input } };
}
export const local = initLocal().paymentIntents.create({ amount: 1 });
