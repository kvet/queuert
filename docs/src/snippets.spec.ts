import { readFile, readdir } from "node:fs/promises";

import { parseSync } from "oxc-parser";
import * as queuert from "queuert";
import { describe, expect, it } from "vitest";

const snippetsDirectory = new URL("./snippets/", import.meta.url);

const appIdentifiers = new Set(["db", "provisionAccount", "stateAdapter"]);

type AstNode = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";

const childNodes = (node: AstNode, keys?: string[]): [string, AstNode][] =>
  Object.entries(node)
    .filter(([key]) => keys === undefined || keys.includes(key))
    .flatMap(([key, value]): [string, AstNode][] =>
      (Array.isArray(value) ? value : [value]).filter(isNode).map((child) => [key, child]),
    );

const freeIdentifiers = (sources: string[]): string[] => {
  const declared = new Set<string>();
  const referenced = new Set<string>();
  const declare = (pattern: AstNode) => {
    if (pattern.type === "Identifier") declared.add(pattern.name as string);
    else if (pattern.type === "Property") declare(pattern.value as AstNode);
    else if (pattern.type === "AssignmentPattern") declare(pattern.left as AstNode);
    else if (pattern.type === "RestElement") declare(pattern.argument as AstNode);
    else for (const [, child] of childNodes(pattern, ["properties", "elements"])) declare(child);
  };
  const walk = (node: AstNode, parent: AstNode | undefined, key: string) => {
    if (node.type.startsWith("TS")) return;
    if (node.type === "Identifier") {
      const isPropertyName =
        (parent?.type === "MemberExpression" && key === "property" && parent.computed !== true) ||
        (parent?.type === "Property" && key === "key" && parent.computed !== true);
      if (!isPropertyName) referenced.add(node.name as string);
      return;
    }
    if (node.type === "VariableDeclarator") declare(node.id as AstNode);
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
      for (const parameter of node.params as AstNode[]) declare(parameter);
      walk(node.body as AstNode, node, "body");
      return;
    }
    for (const [childKey, child] of childNodes(node)) {
      if (node.type === "VariableDeclarator" && childKey === "id") continue;
      walk(child, node, childKey);
    }
  };
  for (const source of sources) {
    const { program, errors } = parseSync("snippet.ts", source, { sourceType: "module" });
    expect(errors).toEqual([]);
    walk(program as unknown as AstNode, undefined, "program");
  }
  return [...referenced].filter((name) => !declared.has(name)).sort();
};

describe("landing page snippets", () => {
  it("only use names from the queuert package entry, apart from the app's own", async () => {
    const files = (await readdir(snippetsDirectory)).filter((file) => file.endsWith(".ts")).sort();
    const sources = await Promise.all(
      files.map(async (file) => readFile(new URL(file, snippetsDirectory), "utf8")),
    );
    const libraryIdentifiers = freeIdentifiers(sources).filter((name) => !appIdentifiers.has(name));

    expect(libraryIdentifiers).toContain("createClient");
    expect(libraryIdentifiers.filter((name) => !(name in queuert))).toEqual([]);
  });
});
