import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Run the repo's own tests, when it has any (brief, M4: "repo tests must run
 * when they exist"). npm's placeholder script, which only fails, is not a test.
 */

export interface TestRun {
  ran: boolean;
  command?: string;
  passed?: boolean;
  /** The last lines of output. */
  output?: string;
  reason?: string;
}

function packageManager(repo: string): string {
  if (existsSync(join(repo, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repo, "yarn.lock"))) return "yarn";
  if (existsSync(join(repo, "bun.lockb")) || existsSync(join(repo, "bun.lock"))) return "bun";
  return "npm";
}

export function testCommand(repo: string): string | undefined {
  const path = join(repo, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.["test"];
    if (!script || /no test specified/.test(script)) return undefined;
    return `${packageManager(repo)} test`;
  } catch {
    return undefined;
  }
}

export function runTests(repo: string, timeoutMs = 10 * 60_000): Promise<TestRun> {
  const command = testCommand(repo);
  if (!command) return Promise.resolve({ ran: false, reason: "no test script in package.json" });
  if (!existsSync(join(repo, "node_modules"))) {
    return Promise.resolve({ ran: false, command, reason: "dependencies are not installed (no node_modules); install them and run the tests" });
  }
  return new Promise((done) => {
    const [bin, ...args] = command.split(" ");
    const child = spawn(bin!, args, { cwd: repo, env: { ...process.env, CI: "1" }, shell: process.platform === "win32" });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ran: true, command, passed: code === 0, output: output.split("\n").slice(-40).join("\n") });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ ran: false, command, reason: err.message });
    });
  });
}
