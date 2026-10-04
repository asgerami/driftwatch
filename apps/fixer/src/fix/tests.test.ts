import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runTests, testCommand } from "./tests.js";

const dirs: string[] = [];
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "driftwatch-tests-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the repo's own tests", () => {
  it("runs the test script with the repo's package manager", () => {
    expect(testCommand(repo({ "package.json": '{"scripts":{"test":"vitest run"}}' }))).toBe("npm test");
    expect(testCommand(repo({ "package.json": '{"scripts":{"test":"vitest run"}}', "pnpm-lock.yaml": "" }))).toBe("pnpm test");
    expect(testCommand(repo({ "package.json": '{"scripts":{"test":"jest"}}', "yarn.lock": "" }))).toBe("yarn test");
  });

  it("does not count npm's placeholder, or a repo with no package.json, as tests", () => {
    expect(testCommand(repo({ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }))).toBeUndefined();
    expect(testCommand(repo({}))).toBeUndefined();
  });

  it("says so rather than failing when dependencies are not installed", async () => {
    const run = await runTests(repo({ "package.json": '{"scripts":{"test":"vitest run"}}' }));
    expect(run).toMatchObject({ ran: false, command: "npm test" });
    expect(run.reason).toContain("node_modules");
  });
});
