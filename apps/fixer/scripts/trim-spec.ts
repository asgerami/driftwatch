/**
 * Cut a real normalized spec down to a fixture: the named operations, and
 * every component they reach. Descriptions stay, since `fix` compares them.
 *
 *   tsx scripts/trim-spec.ts [--no-responses] <normalized.json> "<METHOD> <path>" ... > spec.json
 *
 * --no-responses keeps a request-side fixture small: Stripe's responses reach
 * most of its schemas.
 */
import { readFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const args = process.argv.slice(2);
const noResponses = args[0] === "--no-responses";
const [file, ...ops] = noResponses ? args.slice(1) : args;
if (!file || ops.length === 0) throw new Error("usage: trim-spec <normalized.json> '<METHOD> <path>' ...");
const spec = JSON.parse(readFileSync(file, "utf8")) as Record<string, Json>;
const paths = spec["paths"] as Record<string, Record<string, Json>>;

const out: Record<string, Json> = { openapi: spec["openapi"]!, info: spec["info"]!, servers: spec["servers"] ?? [], paths: {} };
const outPaths = out["paths"] as Record<string, Record<string, Json>>;
for (const op of ops) {
  const [method, ...rest] = op.split(" ");
  const path = rest.join(" ");
  const item = paths[path];
  const body = item?.[method!.toLowerCase()];
  if (!body) throw new Error(`not in the spec: ${op}`);
  outPaths[path] ??= {};
  outPaths[path]![method!.toLowerCase()] =
    noResponses && typeof body === "object" && !Array.isArray(body) && body !== null
      ? { ...body, responses: { "200": { description: "Trimmed for the fixture." } } }
      : body;
  if (item["parameters"]) outPaths[path]!["parameters"] = item["parameters"];
}

// The closure of every local $ref.
const components: Record<string, Record<string, Json>> = {};
const source = (spec["components"] ?? {}) as Record<string, Record<string, Json>>;
const queue: Json[] = [outPaths];
while (queue.length > 0) {
  const node = queue.pop();
  if (Array.isArray(node)) queue.push(...node);
  else if (node && typeof node === "object") {
    const ref = node["$ref"];
    if (typeof ref === "string" && ref.startsWith("#/components/")) {
      const [kind, name] = ref.slice("#/components/".length).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
      if (!components[kind!]?.[name!]) {
        const target = source[kind!]?.[name!];
        if (target !== undefined) {
          (components[kind!] ??= {})[name!] = target;
          queue.push(target);
        }
      }
    }
    queue.push(...Object.values(node));
  }
}
if (Object.keys(components).length > 0) out["components"] = components;
console.log(JSON.stringify(out));
