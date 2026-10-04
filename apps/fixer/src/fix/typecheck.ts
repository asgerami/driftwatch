import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

/**
 * Typecheck a repo with some files replaced in memory, and say what the
 * replacement broke. A real repo often has errors before any patch (a missing
 * `@types` package, a stale generated file), so the test is "no error the
 * patch introduced", not "no errors". Diagnostics are compared by file, code
 * and message, not position: a patch moves the lines below it.
 *
 * JavaScript files are not typechecked unless the repo's own config checks
 * them, and are then at least parsed, so a patch can never leave a syntax
 * error behind.
 */

export interface TypecheckResult {
  /** The repo's own tsconfig.json was used (otherwise strict defaults). */
  configured: boolean;
  filesChecked: number;
  baselineErrors: number;
  errors: number;
  /** Errors present after the patch and not before. */
  introduced: string[];
  /** Modules the typecheck could not resolve: calls on them were not checked. */
  unresolvedModules: string[];
}

const DEFAULTS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  skipLibCheck: true,
  allowJs: false,
};

function config(repo: string): { options: ts.CompilerOptions; files: string[]; configured: boolean } {
  const path = join(repo, "tsconfig.json");
  if (existsSync(path)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(path, { noEmit: true }, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    });
    if (parsed) return { options: { ...parsed.options, noEmit: true }, files: parsed.fileNames, configured: true };
  }
  const files = (ts.sys.readDirectory(repo, [".ts", ".tsx", ".mts", ".cts"], ["**/node_modules", "**/dist", "**/.git"]) ?? []).map((f) => resolve(f));
  return { options: DEFAULTS, files, configured: false };
}

function key(d: ts.Diagnostic, repo: string): string {
  const file = d.file ? d.file.fileName.replace(`${resolve(repo)}/`, "") : "(global)";
  return `${file}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
}

function diagnostics(repo: string, overlay: Map<string, string>, base?: ts.Program) {
  const { options, files, configured } = config(repo);
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => overlay.get(resolve(f)) ?? read(f);
  host.fileExists = (f) => overlay.has(resolve(f)) || ts.sys.fileExists(f);
  host.getSourceFile = (f, language, onError, create) => {
    const text = overlay.get(resolve(f));
    return text !== undefined ? ts.createSourceFile(f, text, language, true) : getSourceFile(f, language, onError, create);
  };
  const program = ts.createProgram({ rootNames: files, options, host, oldProgram: base });
  const list = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
  return { program, list, configured, count: files.length };
}

/** Syntax errors in a JavaScript file the typecheck does not cover. */
function syntaxErrors(file: string, text: string): string[] {
  const out = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { allowJs: true } });
  return (out.diagnostics ?? []).map((d) => `${file}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

/** `overlay`: absolute path → patched text. */
export function typecheck(repo: string, overlay: Map<string, string>): TypecheckResult {
  const before = diagnostics(repo, new Map());
  const after = diagnostics(repo, overlay, before.program);

  const counts = new Map<string, number>();
  for (const d of before.list) counts.set(key(d, repo), (counts.get(key(d, repo)) ?? 0) + 1);
  const introduced: string[] = [];
  for (const d of after.list) {
    const k = key(d, repo);
    const left = counts.get(k) ?? 0;
    if (left > 0) counts.set(k, left - 1);
    else introduced.push(k);
  }

  const checked = new Set(after.program.getSourceFiles().map((f) => resolve(f.fileName)));
  for (const [file, text] of overlay) {
    if (!checked.has(file) && /\.[cm]?jsx?$/.test(file)) introduced.push(...syntaxErrors(file.replace(`${resolve(repo)}/`, ""), text));
  }

  const unresolved = new Set<string>();
  for (const d of before.list) {
    if (d.code !== 2307 && d.code !== 7016) continue;
    const m = /'([^']+)'/.exec(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    if (m) unresolved.add(m[1]!);
  }

  return {
    configured: before.configured,
    filesChecked: before.count,
    baselineErrors: before.list.length,
    errors: after.list.length,
    introduced,
    unresolvedModules: [...unresolved].sort(),
  };
}
