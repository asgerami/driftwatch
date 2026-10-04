import OpenAI from "openai";

const client = new OpenAI();

export async function ask(question: string) {
  const res = await client.chat.completions.create({ model: "m", messages: [{ role: "user", content: question }] }); // driftwatch-expect: sdk
  return res;
}

export class Bot {
  private openai = new OpenAI({ apiKey: "k" });

  reply(question: string) {
    return this.openai.chat.completions.create({ model: "m", messages: [{ role: "user", content: question }] }); // driftwatch-expect: sdk
  }
}

// Not affected: other operations (embeddings; the legacy /completions).
export async function vectors(input: string) {
  return client.embeddings.create({ model: "e", input });
}
export async function legacy(prompt: string) {
  return client.completions.create({ model: "m", prompt });
}
