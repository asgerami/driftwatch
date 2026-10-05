import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/**
 * Which files import which: resolved the way the repo's own compiler would,
 * so the field trace can follow a function into its callers however they
 * import it. Real repos rarely use only relative paths: Next.js projects
 * import `@/lib/api`, libraries re-export through an `index.ts`, monorepos
 * import a sibling package by name. A trace that only matched `./api` lost
 * every read behind one of those, silently.
 *
 * Each file resolves with the nearest tsconfig.json or jsconfig.json above
 * it (monorepo packages have their own), through `ts.resolveModuleName`:
 * `paths`, `baseUrl`, extension mapping, `index` files and workspace
 * symlinks all come from the compiler rather than from a reimplementation.
 */

/** How an importing file can call a function: by a local name, or `ns.member`. */
export type Binding = { kind: "name"; local: string } | { kind: "namespace"; local: string; member: string };

const MAX_REEXPORT_DEPTH = 3;

const DEFAULTS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
};

export class ModuleGraph {
  private readonly options = new Map<string, ts.CompilerOptions>();
  private readonly resolved = new Map<string, string | undefined>();
  private readonly cache = ts.createModuleResolutionCache(process.cwd(), (f) => f);

  constructor(
    private readonly repo: string,
    private readonly sources: Map<string, ts.SourceFile>,
  ) {}

  /** Compiler options for files in `dir`: the nearest config up to the repo root. */
  private optionsFor(dir: string): ts.CompilerOptions {
    const cached = this.options.get(dir);
    if (cached) return cached;
    let found: ts.CompilerOptions | undefined;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
      if (parsed) {
        found = { ...parsed.options, allowJs: true };
        break;
      }
    }
    const parent = dirname(dir);
    const options = found ?? (dir === this.repo || parent === dir || !dir.startsWith(this.repo) ? DEFAULTS : this.optionsFor(parent));
    this.options.set(dir, options);
    return options;
  }

  /** The repo-relative file `spec` resolves to from `fromFile`, if it is one we parsed. */
  resolve(fromFile: string, spec: string): string | undefined {
    const key = `${fromFile}|${spec}`;
    if (this.resolved.has(key)) return this.resolved.get(key);
    const containing = resolve(this.repo, fromFile);
    const options = this.optionsFor(dirname(containing));
    const hit = ts.resolveModuleName(spec, containing, options, ts.sys, this.cache).resolvedModule?.resolvedFileName;
    let file = hit ? relative(this.repo, resolve(hit)).split(sep).join("/") : undefined;
    if (file && !this.sources.has(file)) file = undefined;
    this.resolved.set(key, file);
    return file;
  }

  /**
   * The files that export what `file` exports as `names`, under the names
   * they export it as: the file itself, and barrels re-exporting it.
   */
  private exporters(file: string, names: Set<string>): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>([[file, names]]);
    let frontier = [file];
    for (let depth = 0; depth < MAX_REEXPORT_DEPTH && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const target of frontier) {
        const exported = out.get(target)!;
        for (const [path, source] of this.sources) {
          for (const statement of source.statements) {
            if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
            if (this.resolve(path, statement.moduleSpecifier.text) !== target) continue;
            const names = out.get(path) ?? new Set<string>();
            const before = names.size;
            const clause = statement.exportClause;
            if (!clause) {
              for (const n of exported) if (n !== "default") names.add(n); // export * from
            } else if (ts.isNamedExports(clause)) {
              for (const el of clause.elements) {
                if (exported.has((el.propertyName ?? el.name).text)) names.add(el.name.text);
              }
            }
            if (names.size > before) {
              out.set(path, names);
              next.push(path);
            }
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /** How `importer` binds what `file` exports as `names`, directly or through a barrel. */
  bindings(importer: ts.SourceFile, file: string, names: Set<string>): Binding[] {
    const exporters = this.exporters(file, names);
    const out: Binding[] = [];
    for (const statement of importer.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = this.resolve(importer.fileName, statement.moduleSpecifier.text);
      const exported = target && exporters.get(target);
      const clause = statement.importClause;
      if (!exported || !clause || clause.isTypeOnly) continue;
      if (clause.name && exported.has("default")) out.push({ kind: "name", local: clause.name.text });
      const bound = clause.namedBindings;
      if (bound && ts.isNamedImports(bound)) {
        for (const el of bound.elements) {
          if (!el.isTypeOnly && exported.has((el.propertyName ?? el.name).text)) out.push({ kind: "name", local: el.name.text });
        }
      } else if (bound && ts.isNamespaceImport(bound)) {
        for (const member of exported) if (member !== "default") out.push({ kind: "namespace", local: bound.name.text, member });
      }
    }
    return out;
  }
}

/**
 * The names a function is exported under from its own file: an `export`
 * modifier, `export default`, or a later `export { fn as name }` list.
 */
export function exportNames(fn: ts.Node, local: string): Set<string> {
  const declaration = ts.isFunctionDeclaration(fn) ? fn : fn.parent?.parent?.parent; // VariableStatement
  return exportNamesOf(fn.getSourceFile(), local, declaration);
}

/** The names `local` is exported under, given the statement that declares it. */
export function exportNamesOf(source: ts.SourceFile, local: string, declaration?: ts.Node): Set<string> {
  const names = new Set<string>();
  const modifiers = declaration && ts.canHaveModifiers(declaration) ? (ts.getModifiers(declaration) ?? []) : [];
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    names.add(modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : local);
  }
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression) && statement.expression.text === local) {
      names.add("default");
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const el of statement.exportClause.elements) if ((el.propertyName ?? el.name).text === local) names.add(el.name.text);
    }
  }
  return names;
}
