// OpenAI made `model` required on image generation and edits, and dropped
// the dall-e-2 default in the same release. The spec documents no value to
// send, so a call that leaves it out is reported for a person to choose one,
// and a call that already sends it is not reported at all.

const OPENAI = "https://api.openai.com/v1";

// Real case (haydarkadioglu/hyperframe-studio): the model is a fallback
// expression, so it is always sent. Reporting it was a false positive.
export async function generate(prompt: string, apiKey: string, model?: string) {
  return fetch(`${OPENAI}/images/generations`, { // driftwatch-expect: http
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });
}

// Relied on the dall-e-2 default: needs a person to pick a model.
export async function sketch(prompt: string, apiKey: string) {
  return fetch(`${OPENAI}/images/generations`, { // driftwatch-expect: http
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt, n: 1, size: "512x512" }),
  });
}
