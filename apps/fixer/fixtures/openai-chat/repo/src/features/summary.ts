import { ask, complete, completeRaw } from "@/lib";
import fetchCompletion from "@/client";
import * as chat from "../chat";
import { complete as completeLocally } from "@/fake";

// Through a path alias and a barrel.
export async function summarize(body: string) {
  const reply = await complete(body);
  return reply.system_fingerprint; // driftwatch-expect: field
}

// `export * from` in the barrel.
export async function viaSdk(question: string) {
  const { system_fingerprint } = await ask(question); // driftwatch-expect: field
  return system_fingerprint;
}

// A default export, imported by alias.
export async function viaDefault(body: string) {
  return (await fetchCompletion(body)).system_fingerprint; // driftwatch-expect: field
}

// A default export, re-exported under a name by the barrel.
export async function viaBarrelDefault(body: string) {
  const reply = await completeRaw(body);
  return reply.system_fingerprint; // driftwatch-expect: field
}

// A namespace import.
export async function viaNamespace(body: string) {
  const reply = await chat.complete(body);
  return reply.system_fingerprint; // driftwatch-expect: field
}

// Same name, different module: not the API, not reported.
export async function offline(body: string) {
  const reply = await completeLocally(body);
  return reply.system_fingerprint;
}
