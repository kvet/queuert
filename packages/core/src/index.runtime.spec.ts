import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const helpersEntry = resolve(
  import.meta.dirname,
  "../../../packages-internal/helpers/src/index.ts",
);

const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((match) => match[1]);

const collectImports = (entry: string): { files: Set<string>; external: Set<string> } => {
  const files = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier));
      else if (specifier === "@queuert/helpers") visit(helpersEntry);
      else external.add(specifier);
    }
  };
  visit(entry);
  return { files, external };
};

describe.each(["index.ts", "internal.ts"])("queuert entry point %s", (entry) => {
  it("uses no Node.js built-in module or global, so it runs in browsers and edge runtimes", () => {
    const { files, external } = collectImports(resolve(import.meta.dirname, entry));

    expect(files.size).toBeGreaterThan(10);
    expect([...external].filter((specifier) => specifier.startsWith("node:"))).toEqual([]);
    expect(
      [...files].filter((file) =>
        /(?<![\w./-])(?:Buffer\.\w|process\.\w|__dirname\b|__filename\b)/.test(
          readFileSync(file, "utf8"),
        ),
      ),
    ).toEqual([]);
  });
});
