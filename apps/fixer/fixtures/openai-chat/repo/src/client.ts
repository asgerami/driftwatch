// A default export.
export default async function fetchCompletion(body: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body }); // driftwatch-expect: http
  return res.json();
}
