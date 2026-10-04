import axios from "axios";
import ky from "ky";

const STRIPE = "https://api.stripe.com/v1";
const stripeHttp = axios.create({ baseURL: STRIPE });
const api = ky.create({ prefixUrl: "https://api.stripe.com/v1" });

export async function createIntent(body: URLSearchParams) {
  return fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", body }); // driftwatch-expect: http
}

export async function createWithAxios(form: URLSearchParams) {
  return axios.post(`${STRIPE}/payment_intents`, form); // driftwatch-expect: http
}

export async function updateIntent(id: string, form: URLSearchParams) {
  return stripeHttp.post(`/payment_intents/${id}`, form); // driftwatch-expect: http
}

export async function confirmIntent(id: string, body: URLSearchParams) {
  return api.post(`payment_intents/${id}/confirm`, { body }); // driftwatch-expect: http
}

// Not affected: reading an intent, and listing them, are GETs.
export async function retrieveIntent(id: string) {
  return fetch(`${STRIPE}/payment_intents/${id}`);
}

export async function listIntents() {
  return axios.get(`${STRIPE}/payment_intents`);
}

// Not Stripe: our own API happens to use the same path.
export async function mirrorToOurApi(body: string) {
  return fetch("https://api.mycompany.com/v1/payment_intents", { method: "POST", body });
}

// Not HTTP at all.
const cache = new Map<string, unknown>();
export const cached = cache.get("/v1/payment_intents");

// Fully dynamic: could be anything, so never reported.
export async function forward(url: string, init: RequestInit) {
  return fetch(url, init);
}
