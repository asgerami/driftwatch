import initStripe from "../lib/init.js";

export async function POST() {
  const stripe = initStripe();
  return stripe.setupIntents.create({ usage: "off_session" }); // driftwatch-expect: sdk
}
