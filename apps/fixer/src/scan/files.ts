import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** TypeScript and JavaScript only, for now (brief: M4). */
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "out", ".turbo", "vendor"]);
/** Larger files are bundles or generated code, not where a person calls an API. */
const MAX_BYTES = 1_000_000;

export interface SourceFile {
  /** Relative to the repo root, forward slashes. */
  path: string;
  text: string;
}

export async function sourceFiles(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
      if ((await stat(full)).size > MAX_BYTES) continue;
      out.push({ path: relative(root, full).split(sep).join("/"), text: await readFile(full, "utf8") });
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
