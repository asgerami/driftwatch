import ts from "typescript";
import { describe, expect, it } from "vitest";

import { exportNames } from "./modules.js";

function fn(code: string, name: string): ts.Node {
  const source = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && node.parent.name.getText() === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found!;
}

describe("the names a function is exported under", () => {
  it("covers export modifiers, default exports and export lists", () => {
    expect([...exportNames(fn("export async function run() {}", "run"), "run")]).toEqual(["run"]);
    expect([...exportNames(fn("export default async function run() {}", "run"), "run")]).toEqual(["default"]);
    expect([...exportNames(fn("export const run = async () => 1;", "run"), "run")]).toEqual(["run"]);
    expect([...exportNames(fn("const run = async () => 1;\nexport default run;", "run"), "run")]).toEqual(["default"]);
    expect([...exportNames(fn("function run() {}\nexport { run as complete, run };", "run"), "run")].sort()).toEqual(["complete", "run"]);
  });

  it("is empty for a function the file keeps to itself", () => {
    expect(exportNames(fn("function run() {}\nexport const other = 1;", "run"), "run").size).toBe(0);
  });
});
