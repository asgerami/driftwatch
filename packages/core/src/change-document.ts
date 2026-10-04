/**
 * The machine-readable form of one published story, for the fixer CLI
 * (`driftwatch scan --change <id>`). Facts as stored, plus where the spec
 * lives at the release that introduced them, so a consumer can recompute
 * anything the facts summarize (like which operations reach a component).
 */
export interface ChangeDocument {
  version: 1;
  id: string;
  url: string;
  provider: { slug: string; name: string };
  severity: string;
  ruleId: string;
  shippedAt: string;
  facts: {
    ruleId: string;
    severity: string;
    method?: string;
    path?: string;
    operationId?: string;
    componentName?: string;
    fieldPath?: string;
    jsonPointer: string;
    detail?: string;
    before?: unknown;
    after?: unknown;
    affectedOperations?: number;
  }[];
  spec:
    | { kind: "git"; repo: string; filePath: string; fromSha?: string; toSha: string }
    | { kind: "hosted"; url: string };
}
