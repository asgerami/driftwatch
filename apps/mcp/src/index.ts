#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { DEFAULT_FEED_URL, fetchFeed, type Severity } from "./feed.js";
import { formatBreakingSummary, formatReleases } from "./format.js";

const MIN_SEVERITY = z
  .enum(["BREAKING", "DEPRECATION", "BEHAVIORAL", "ADDITIVE"])
  .optional()
  .describe("Lowest severity to include. Default BEHAVIORAL omits additive noise.");

async function main(): Promise<void> {
  const server = new McpServer({
    name: "driftwatch",
    version: "0.1.0",
  });

  server.tool(
    "list_changes",
    "Published OpenAPI drift from APIs this repo may depend on. Spec-derived; severity is a deterministic ruleset, not a model.",
    {
      provider: z
        .string()
        .optional()
        .describe("Provider slug, e.g. stripe, openai, github, twilio, hetzner"),
      limit: z.number().int().min(1).max(50).optional().describe("Max releases. Default 20."),
      minSeverity: MIN_SEVERITY,
    },
    async ({ provider, limit, minSeverity }) => {
      const feed = await fetchFeed({
        provider,
        limit: limit ?? 20,
        preferSignal: true,
      });
      const text = formatReleases(feed.releases, (minSeverity as Severity | undefined) ?? "BEHAVIORAL");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "breaking_changes",
    "Whether any published change is breaking, a deprecation, or a behavioural shift. Use mid-task before trusting a vendor client.",
    {
      provider: z.string().optional().describe("Provider slug. Omit for every watched API."),
    },
    async ({ provider }) => {
      const feed = await fetchFeed({
        provider,
        limit: 40,
        preferSignal: true,
      });
      const text = formatBreakingSummary(feed.releases);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // Stdio is the protocol; diagnostics go to stderr.
  console.error(`driftwatch-mcp: ${(err as Error).message}`);
  console.error(`feed: ${DEFAULT_FEED_URL}`);
  process.exit(1);
});
