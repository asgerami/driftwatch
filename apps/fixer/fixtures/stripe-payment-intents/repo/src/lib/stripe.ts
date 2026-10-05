// One client for the whole app: how most repos hold an SDK client.
import Stripe from "stripe";

let client: Stripe | undefined;

export function getStripe(): Stripe {
  client ??= new Stripe(process.env.STRIPE_KEY!);
  return client;
}

export const shared = new Stripe(process.env.STRIPE_KEY!);
export default shared;
