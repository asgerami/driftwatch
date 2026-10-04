// Plain JavaScript is scanned too.
const base = "https://api.stripe.com";

export async function recreate(params) {
  const res = await fetch(base + "/v1/payment_intents", { method: "POST", body: params }); // driftwatch-expect: http
  return res.json();
}
