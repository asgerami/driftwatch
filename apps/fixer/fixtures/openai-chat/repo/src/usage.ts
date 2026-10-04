import { complete, completeWithAxios } from "./chat";
import { ask } from "./assistant.js";

// Through a function that returns `res.json()`, from another file.
export async function fingerprint(body: string) {
  const reply = await complete(body);
  return reply.system_fingerprint; // driftwatch-expect: field
}

// axios: the body is under `.data`.
export async function viaAxios(body: unknown) {
  const { data } = await completeWithAxios(body);
  const { system_fingerprint: seed, choices } = data; // driftwatch-expect: field
  return { seed, first: choices[0] };
}

// The SDK returns the body itself.
export async function viaSdk(question: string) {
  const answer = await ask(question);
  if (answer.system_fingerprint) { // driftwatch-expect: field
    return answer.choices[0]?.message.content;
  }
  return answer.model;
}

// Not traced, but read in a file that makes an affected call: a guess.
export function logRun(completion: { system_fingerprint?: string }) {
  console.log(completion.system_fingerprint); // driftwatch-expect: field
}
