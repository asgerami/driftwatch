import type { Change } from "../diff/index.js";

/**
 * Impact rendering.
 *
 * Severity is decided by the ruleset and never appears here. What this module
 * produces is the human half: a headline, a short explanation, and the shape
 * of the code that breaks.
 *
 * It is deliberately deterministic. A model is not needed to say what a
 * removed field does to a property access, and a template that always
 * produces the same output is reproducible, instant, free, and cannot
 * hallucinate a field name that does not exist. `enrich()` is the seam where
 * a model can later add prose for the handful of rules where templates read
 * thin, without ever touching severity.
 */

export interface RenderedImpact {
  headline: string;
  /** Markdown. */
  body: string;
  patterns: { ts?: string; py?: string; go?: string };
}

const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Render a dotted field path as calling code would access it. */
function accessTs(root: string, fieldPath: string | undefined): string {
  if (!fieldPath) return root;
  let out = root;
  for (const raw of fieldPath.split(".")) {
    const arrays = raw.match(/\[\]/g)?.length ?? 0;
    const key = raw.replace(/\[\]/g, "").replace(/\[key\]/g, "");
    if (!key) continue;
    out += SAFE_IDENTIFIER.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
    for (let i = 0; i < arrays; i++) out += "[0]";
  }
  return out;
}

function accessPy(root: string, fieldPath: string | undefined): string {
  if (!fieldPath) return root;
  let out = root;
  for (const raw of fieldPath.split(".")) {
    const arrays = raw.match(/\[\]/g)?.length ?? 0;
    const key = raw.replace(/\[\]/g, "").replace(/\[key\]/g, "");
    if (!key) continue;
    out += `[${JSON.stringify(key)}]`;
    for (let i = 0; i < arrays; i++) out += "[0]";
  }
  return out;
}

function leaf(fieldPath: string | undefined): string {
  if (!fieldPath) return "value";
  return fieldPath.split(".").pop()!.replace(/\[\]|\[key\]/g, "") || "value";
}

function quotedValues(detail: string | undefined): string[] {
  if (!detail) return [];
  return [...detail.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

function where(change: Change): string {
  if (change.componentName) {
    const reach = change.affectedOperations
      ? ` reachable from ${change.affectedOperations} operation${change.affectedOperations === 1 ? "" : "s"}`
      : "";
    return `\`${change.componentName}\`${reach}`;
  }
  if (change.method && change.path) {
    return `\`${change.method.toUpperCase()} ${change.path}\``;
  }
  return change.path ? `\`${change.path}\`` : "this API";
}

function subject(change: Change): string {
  return change.fieldPath ? `\`${change.fieldPath}\`` : "this value";
}

export function renderImpact(change: Change): RenderedImpact {
  const site = where(change);
  const field = subject(change);
  const patterns: RenderedImpact["patterns"] = {};
  let headline = change.headline;
  let body = `${change.consequence}\n\nAffects ${site}.`;

  switch (change.ruleId) {
    case "path.removed":
    case "operation.removed": {
      headline = `${change.method ? `${change.method.toUpperCase()} ` : ""}${change.path} removed`;
      patterns.ts = `// Was:\nawait client.request("${change.method?.toUpperCase() ?? "GET"}", "${change.path}");\n// Now: ${change.ruleId === "path.removed" ? "404" : "405"}`;
      break;
    }

    case "operation.deprecated": {
      headline = `${change.method?.toUpperCase() ?? ""} ${change.path} deprecated`.trim();
      body =
        `${change.consequence}\n\nAffects ${site}. Nothing breaks today, which is exactly why this is worth acting on now rather than when it starts returning 404.`;
      break;
    }

    case "response.property.removed": {
      headline = `Response field ${leaf(change.fieldPath)} removed`;
      patterns.ts = `// ${accessTs("response", change.fieldPath)} is now undefined\nconst ${leaf(change.fieldPath)} = ${accessTs("response", change.fieldPath)};`;
      patterns.py = `# raises KeyError\n${leaf(change.fieldPath)} = ${accessPy("response", change.fieldPath)}`;
      break;
    }

    case "response.property.became-optional": {
      headline = `Response field ${leaf(change.fieldPath)} is no longer guaranteed`;
      patterns.ts = `// ${accessTs("response", change.fieldPath)} may now be absent or null\nconst ${leaf(change.fieldPath)} = ${accessTs("response", change.fieldPath)} ?? fallback;`;
      // .get() on the PARENT, since the leaf is what may now be missing.
      const parent = (change.fieldPath ?? "").replace(/\.?[^.]+$/, "");
      patterns.py = `${leaf(change.fieldPath)} = ${accessPy("response", parent)}.get(${JSON.stringify(leaf(change.fieldPath))})`;
      body =
        `${change.consequence}\n\nAffects ${field} on ${site}. Nothing fails at the call; it fails wherever the value is finally used, which is usually somewhere else entirely.`;
      break;
    }

    case "response.enum.value-added": {
      const values = quotedValues(change.detail);
      const name = leaf(change.fieldPath);
      headline = values.length
        ? `${name} can now return ${values.map((v) => `"${v}"`).join(", ")}`
        : `${name} gained response values`;
      patterns.ts =
        `switch (${accessTs("response", change.fieldPath)}) {\n` +
        `  // existing branches …\n` +
        values.map((v) => `  // no branch for ${JSON.stringify(v)}`).join("\n") +
        `\n  default:\n    throw new Error("unexpected ${name}");\n}`;
      body =
        `${change.consequence}\n\nAffects ${field} on ${site}.` +
        (values.length
          ? `\n\nNew value${values.length === 1 ? "" : "s"}: ${values.map((v) => `\`${v}\``).join(", ")}.`
          : "");
      break;
    }

    case "response.property.type-changed":
    case "request.property.type-changed": {
      headline = `${leaf(change.fieldPath)} changed type`;
      const from = typeof change.before === "string" ? change.before : "before";
      const to = typeof change.after === "string" ? change.after : "after";
      patterns.ts = `// ${accessTs("payload", change.fieldPath)}\n// was: ${from}\n// now: ${to}`;
      break;
    }

    case "request.param.required-added":
    case "request.param.became-required":
    case "request.property.became-required": {
      headline = `${leaf(change.fieldPath)} is now required`;
      patterns.ts = `await client.post("${change.path ?? "/…"}", {\n  // …\n  ${leaf(change.fieldPath)}: /* now required */,\n});`;
      break;
    }

    case "request.param.removed":
    case "request.property.removed": {
      headline = `${leaf(change.fieldPath)} is no longer accepted`;
      patterns.ts = `await client.post("${change.path ?? "/…"}", {\n  // ${leaf(change.fieldPath)} is now ignored, not rejected\n  ${leaf(change.fieldPath)}: value,\n});`;
      body =
        `${change.consequence}\n\nAffects ${field} on ${site}. Grep for it: nothing else will tell you.`;
      break;
    }

    case "request.enum.value-removed": {
      const values = quotedValues(change.detail);
      headline = values.length
        ? `${leaf(change.fieldPath)} no longer accepts ${values.map((v) => `"${v}"`).join(", ")}`
        : `${leaf(change.fieldPath)} withdrew accepted values`;
      patterns.ts = values
        .map((v) => `// sending ${JSON.stringify(v)} for ${change.fieldPath} is now rejected`)
        .join("\n");
      break;
    }

    case "security.scope-added": {
      headline = `New scope required on ${change.path ?? "this operation"}`;
      body =
        `${change.consequence}\n\nAffects ${site}. Scopes now: \`${String(change.after ?? "")}\`. ` +
        `This is the one category you cannot fix by shipping code, so it needs lead time.`;
      break;
    }

    case "pagination.default-changed": {
      headline = `Pagination default for ${leaf(change.fieldPath)} changed to ${JSON.stringify(change.after)}`;
      patterns.ts = `// Unpaginated calls now return ${JSON.stringify(change.after)} items, previously ${JSON.stringify(change.before)}\nconst page = await client.get("${change.path ?? "/…"}");`;
      body =
        `${change.consequence}\n\nAffects ${field} on ${site}. Code that never paginated keeps returning 200 and quietly returns less data.`;
      break;
    }

    case "response.status-code.added": {
      headline = `${String(change.after ?? "")} is now documented on ${change.path ?? "this operation"}`;
      break;
    }

    default:
      break;
  }

  return { headline, body, patterns };
}

/**
 * Seam for optional model-written prose.
 *
 * Anything passed here may rewrite `body` only. `headline` stays templated so
 * feed titles remain stable across re-renders, and severity is not in scope at
 * all: it was decided before this module ever saw the change.
 */
export async function enrich(
  impact: RenderedImpact,
  writer?: (impact: RenderedImpact) => Promise<string>,
): Promise<RenderedImpact> {
  if (!writer) return impact;
  try {
    return { ...impact, body: await writer(impact) };
  } catch {
    return impact;
  }
}
