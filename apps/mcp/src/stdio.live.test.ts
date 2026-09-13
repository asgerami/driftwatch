import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FEED = process.env.DRIFTWATCH_FEED_URL ?? "http://localhost:3000/api/feed.json";

async function feedReachable(): Promise<boolean> {
  try {
    const response = await fetch(FEED, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

describe("stdio MCP against a live feed", () => {
  let live = false;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  beforeAll(async () => {
    live = await feedReachable();
    if (!live) return;

    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { DRIFTWATCH_FEED_URL: FEED },
      stderr: "pipe",
    });
    client = new Client({ name: "driftwatch-live-test", version: "0" });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client?.close();
    await transport?.close();
  });

  it("lists tools and returns OpenAI breaking changes from the published feed", async () => {
    if (!live || !client) return;

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "breaking_changes",
      "list_changes",
    ]);

    const result = await client.callTool({
      name: "breaking_changes",
      arguments: { provider: "openai" },
    });
    const text = (result.content as { type: string; text: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/OpenAI|Nothing breaking/);
  }, 20_000);
});
