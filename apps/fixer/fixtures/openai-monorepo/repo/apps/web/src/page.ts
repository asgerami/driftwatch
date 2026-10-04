import { chatCompletion } from "@acme/api";
import { relay } from "~/util";

// A sibling package, by the name this package's tsconfig maps.
export async function render(body: string) {
  const reply = await chatCompletion(body);
  return reply.system_fingerprint; // driftwatch-expect: field
}

// "~/util" is apps/web/src/util.ts here, by the nearest tsconfig: not the API.
export async function cached(body: string) {
  const reply = await relay(body);
  return reply.system_fingerprint;
}
