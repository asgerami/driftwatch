export async function chatCompletion(body: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body }); // driftwatch-expect: http
  return res.json();
}
