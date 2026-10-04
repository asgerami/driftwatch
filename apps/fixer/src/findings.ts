/** One place in a repo a change may break. */
export interface Finding {
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  /** 1-based. */
  line: number;
  column: number;
  /** The source line, trimmed. */
  snippet: string;
  kind: "http" | "sdk" | "field";
  /** The API operation involved, "POST /v1/payment_intents". */
  operation?: string;
  /**
   * high: URL (or SDK method) and HTTP method fully resolved and matching.
   * medium: matched, but part of the URL or the method is only inferred.
   * low: a guess worth a look; never patched.
   */
  confidence: "high" | "medium" | "low";
  why: string;
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => RANK[a.confidence] - RANK[b.confidence] || a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** A call a finder matched, handed to the field finder to follow its result. */
export interface MatchedCall {
  /** The call expression node (TypeScript AST). */
  node: import("typescript").CallExpression;
  op: import("./targets.js").TargetOperation;
  /** As the finding shows it, with a wildcard method resolved from the call. */
  operation: string;
  /**
   * Where the response body sits in the returned value: axios and Octokit
   * wrap it in `.data`; fetch needs `.json()`; SDKs like Stripe's and
   * OpenAI's return it directly.
   */
  body: "direct" | "data" | "fetch";
  confidence: Finding["confidence"];
}
