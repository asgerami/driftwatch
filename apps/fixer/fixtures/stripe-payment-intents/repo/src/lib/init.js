// The Golobe travel app's shape: a factory in one module, called in another.
import Stripe from "stripe";

export default function initStripe() {
  return new Stripe(process.env.STRIPE_KEY);
}
