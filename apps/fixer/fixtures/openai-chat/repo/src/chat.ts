import axios from "axios";

const OPENAI_BASE = process.env.OPENAI_BASE_URL;
const openai = axios.create({ baseURL: "https://api.openai.com/v1" });

export async function complete(body: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", { // driftwatch-expect: http
    method: "POST",
    body,
  });
  return res.json();
}

export async function completeWithAxios(body: unknown) {
  return openai.post("/chat/completions", body); // driftwatch-expect: http
}

export async function completeWithConfig(data: unknown) {
  return axios({ url: "https://api.openai.com/v1/chat/completions", method: "post", data }); // driftwatch-expect: http
}

// Base URL only known at runtime: still found, at lower confidence.
export async function completeViaProxy(body: string) {
  return fetch(`${OPENAI_BASE}/chat/completions`, { method: "POST", body }); // driftwatch-expect: http
}

// Not affected: embeddings return a different component.
export async function embed(body: string) {
  return fetch("https://api.openai.com/v1/embeddings", { method: "POST", body });
}

export async function streamed(body: string) {
  return fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body }) // driftwatch-expect: http
    .then((r) => r.json())
    .then((json) => json.system_fingerprint as string); // driftwatch-expect: field
}

// Embeddings carry no fingerprint; a read of other fields is not reported.
export async function dimensions(body: string) {
  const res = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", body });
  const json = await res.json();
  return json.data[0].embedding.length;
}
