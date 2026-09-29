/**
 * The consumer-direction ruleset.
 *
 * Producer tools classify by "does this break my callers?". Driftwatch sits on
 * the calling end, and three rules invert there. Those three carry
 * `directionFlip` and are the reason anyone subscribes:
 *
 *   1. response.property.became-optional  — safe for a producer, a null
 *      dereference waiting to happen for a consumer.
 *   2. response.enum.value-added          — additive for a producer, breaks
 *      exhaustive switches and generated client enums for a consumer.
 *   3. request.param.removed              — throws no error at all. The
 *      provider ignores the argument and your results quietly change.
 *
 * `confidence` gates publication. Anything structural and unambiguous scores
 * high; anything inferred from naming or documented prose scores lower and is
 * held for review. It is never a measure of how bad the change is.
 */

export const SEVERITIES = [
  "BREAKING",
  "DEPRECATION",
  "BEHAVIORAL",
  "ADDITIVE",
  "COSMETIC",
] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface Rule {
  id: string;
  severity: Severity;
  /** Producer-side tools classify this the other way. */
  directionFlip?: boolean;
  confidence: number;
  /** One line, present tense, no provider name. Rendered into the feed. */
  headline: string;
  /** What it does to calling code. */
  consequence: string;
}

function rule(r: Rule): Rule {
  return r;
}

export const RULES: Record<string, Rule> = Object.fromEntries(
  [
    // ── endpoint surface ───────────────────────────────────────────────
    rule({
      id: "path.removed",
      severity: "BREAKING",
      confidence: 100,
      headline: "Endpoint removed",
      consequence: "Requests to this path now 404.",
    }),
    rule({
      id: "operation.removed",
      severity: "BREAKING",
      confidence: 100,
      headline: "Operation removed",
      consequence:
        "This verb now 405s. The path still resolves, so a health check on the URL will not catch it.",
    }),
    rule({
      id: "operation.deprecated",
      severity: "DEPRECATION",
      confidence: 100,
      headline: "Operation deprecated",
      consequence:
        "Still works today. This is the earliest warning you will get before it is removed.",
    }),
    rule({
      id: "path.added",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Endpoint added",
      consequence: "No action needed.",
    }),
    rule({
      id: "operation.added",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Operation added",
      consequence: "No action needed.",
    }),
    rule({
      id: "operation.undeprecated",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Deprecation lifted",
      consequence: "The operation is supported again.",
    }),

    // ── request ────────────────────────────────────────────────────────
    rule({
      id: "request.param.required-added",
      severity: "BREAKING",
      confidence: 100,
      headline: "New required parameter",
      consequence: "Every existing call that omits it is rejected.",
    }),
    rule({
      id: "request.param.removed",
      severity: "BREAKING",
      directionFlip: true,
      confidence: 90,
      headline: "Parameter no longer accepted",
      consequence:
        "No error is raised. The value is ignored and your results change silently, which is the hardest class of break to notice.",
    }),
    rule({
      id: "request.param.unlisted",
      severity: "COSMETIC",
      confidence: 100,
      headline: "Parameter no longer listed on this operation",
      consequence:
        "The same parameter still exists as a shared component, or on other operations. This is a documentation drop, not a withdrawn argument.",
    }),
    rule({
      id: "request.param.became-required",
      severity: "BREAKING",
      confidence: 100,
      headline: "Parameter is now required",
      consequence: "Calls that omit it are rejected.",
    }),
    rule({
      id: "request.property.became-required",
      severity: "BREAKING",
      confidence: 100,
      headline: "Body property is now required",
      consequence: "Partial payloads are rejected.",
    }),
    rule({
      id: "request.property.removed",
      severity: "BREAKING",
      directionFlip: true,
      confidence: 85,
      headline: "Body property no longer accepted",
      consequence:
        "Usually ignored rather than rejected, so the call succeeds and does something subtly different.",
    }),
    rule({
      id: "request.enum.value-removed",
      severity: "BREAKING",
      confidence: 100,
      headline: "Accepted value withdrawn",
      consequence: "A value you may have hardcoded is now rejected.",
    }),
    rule({
      id: "request.property.type-changed",
      severity: "BREAKING",
      confidence: 95,
      headline: "Request type changed",
      consequence:
        "Serialization mismatch. Integer-to-string moves are the usual cause and the usual outage.",
    }),
    rule({
      id: "request.enum.constraint-removed",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Value restriction lifted",
      consequence:
        "A relaxation, not a break. Everything you could send before still works, and more is accepted now.",
    }),
    rule({
      id: "request.property.became-nullable",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Request field now accepts null",
      consequence: "A relaxation. Existing payloads are unaffected.",
    }),
    rule({
      id: "request.param.optional-added",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "New optional parameter",
      consequence: "No action needed.",
    }),
    rule({
      id: "request.property.added",
      severity: "ADDITIVE",
      confidence: 95,
      headline: "New request property",
      consequence: "No action needed unless it is required.",
    }),

    // ── response ───────────────────────────────────────────────────────
    rule({
      id: "response.property.removed",
      severity: "BREAKING",
      confidence: 100,
      headline: "Response field removed",
      consequence:
        "Reads of this field return undefined, and the failure surfaces wherever that value is used rather than at the call.",
    }),
    rule({
      id: "response.property.became-optional",
      severity: "BREAKING",
      directionFlip: true,
      confidence: 90,
      headline: "Response field is no longer guaranteed",
      consequence:
        "Producer-side tools call this non-breaking. For a consumer it is a null dereference on an unknown future date.",
    }),
    rule({
      id: "response.enum.value-added",
      severity: "BREAKING",
      directionFlip: true,
      confidence: 85,
      headline: "New value can now appear in responses",
      consequence:
        "Producer-side tools call this additive. It breaks exhaustive switches, strict parsers and generated client enums.",
    }),
    rule({
      id: "response.enum.constraint-removed",
      severity: "BREAKING",
      directionFlip: true,
      confidence: 85,
      headline: "Response values are no longer constrained",
      consequence:
        "The documented set of values is gone, so anything can appear. Every exhaustive switch and generated enum over this field is now incomplete.",
    }),
    rule({
      id: "response.property.type-changed",
      severity: "BREAKING",
      confidence: 95,
      headline: "Response type changed",
      consequence: "Parse failure, or silent coercion depending on your client.",
    }),
    rule({
      id: "response.property.type-narrowed",
      severity: "ADDITIVE",
      confidence: 100,
      headline: "Response type narrowed",
      consequence:
        "A tighter guarantee, not a break. Every value you can receive now was already possible, so existing handling still covers it; a null check here may now be dead code.",
    }),
    rule({
      id: "response.property.now-always-null",
      severity: "BEHAVIORAL",
      confidence: 80,
      headline: "Response field is now always null",
      consequence:
        "Nothing throws, since the field could already be null, but the value you read here is gone. Often a spec-generator artifact, so it is held for a person to check.",
    }),
    rule({
      id: "response.status-code.added",
      severity: "BEHAVIORAL",
      confidence: 90,
      headline: "New documented status code",
      consequence: "An unhandled branch in your error handling.",
    }),
    rule({
      id: "response.status-code.removed",
      severity: "BEHAVIORAL",
      confidence: 90,
      headline: "Status code no longer documented",
      consequence: "Dead branch, or an undocumented response you still receive.",
    }),
    rule({
      id: "response.property.added",
      severity: "ADDITIVE",
      confidence: 95,
      headline: "New response field",
      consequence:
        "No action needed unless you validate responses against a closed schema.",
    }),

    // ── auth and limits ────────────────────────────────────────────────
    rule({
      id: "security.scope-added",
      severity: "BREAKING",
      confidence: 95,
      headline: "New scope required",
      consequence:
        "Existing tokens 403. This needs user re-consent, not a code change, so it cannot be fixed by deploying.",
    }),
    rule({
      id: "security.scheme-changed",
      severity: "BREAKING",
      confidence: 90,
      headline: "Authentication scheme changed",
      consequence: "The integration needs reworking, not patching.",
    }),
    rule({
      id: "security.requirement-removed",
      severity: "BEHAVIORAL",
      confidence: 80,
      headline: "Security requirement removed",
      consequence: "The operation no longer demands this credential.",
    }),

    // ── semantics ──────────────────────────────────────────────────────
    rule({
      id: "pagination.default-changed",
      severity: "BEHAVIORAL",
      confidence: 85,
      headline: "Pagination default changed",
      consequence:
        "Silent truncation. Code that does not paginate keeps working and quietly returns a different slice of the data.",
    }),
    rule({
      id: "default.value-changed",
      severity: "BEHAVIORAL",
      confidence: 85,
      headline: "Default value changed",
      consequence: "Behavior shifts for every call that omits the field.",
    }),
    rule({
      id: "schema.ref-retargeted",
      severity: "BEHAVIORAL",
      confidence: 80,
      headline: "Field points at a different schema",
      consequence:
        "Often a rename with an identical shape, sometimes a genuine retype. The structural diff cannot tell which, so this is held below the publish threshold on purpose.",
    }),
    rule({
      id: "cosmetic.schema-renamed",
      severity: "COSMETIC",
      confidence: 100,
      headline: "Schema renamed",
      consequence: "The shape is identical. Only the name changed.",
    }),
    rule({
      id: "schema.composition-changed",
      severity: "BEHAVIORAL",
      confidence: 70,
      headline: "Schema composition changed",
      consequence:
        "The set of shapes this value can take changed. Worth a look, but the structural diff cannot say precisely how.",
    }),

    // ── noise sink ─────────────────────────────────────────────────────
    rule({
      id: "cosmetic.description-changed",
      severity: "COSMETIC",
      confidence: 100,
      headline: "Documentation text changed",
      consequence: "None.",
    }),
  ].map((r) => [r.id, r]),
);

export function ruleFor(id: string): Rule {
  const found = RULES[id];
  if (!found) throw new Error(`unknown rule id: ${id}`);
  return found;
}

/** Below this, a change is stored but held back from the feed. */
export const PUBLISH_CONFIDENCE_THRESHOLD = 85;

/** Severities that never reach the feed regardless of confidence. */
export const UNPUBLISHED_SEVERITIES: ReadonlySet<Severity> = new Set([
  "COSMETIC",
]);
