// The older CommonJS style: require("stripe")(key).
const stripe = require("stripe")(process.env.STRIPE_KEY);

async function run() {
  await stripe.paymentIntents.create({ amount: 100, currency: "usd" }); // driftwatch-expect: sdk
}

module.exports = { run };
