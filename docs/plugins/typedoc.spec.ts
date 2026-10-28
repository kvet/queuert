import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderMarkdownReference } from "./typedoc.ts";

describe("renderMarkdownReference", () => {
  let directory: string;
  let client: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "queuert-typedoc-"));
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, target: "es2022" }, include: ["*.ts"] }),
    );
    await writeFile(
      join(directory, "index.ts"),
      [
        'const helpersSymbol = Symbol("queuert.helpers");',
        "/** A client. */",
        "export type Client = {",
        "  readonly [helpersSymbol]: string;",
        "  /** Start the client. */",
        "  start: (options: { name: string }) => Promise<void>;",
        "};",
      ].join("\n"),
    );
    await renderMarkdownReference({
      entryPoint: join(directory, "index.ts"),
      tsconfig: join(directory, "tsconfig.json"),
      name: "fixture",
      out: join(directory, "out"),
    });
    client = await readFile(join(directory, "out", "type-aliases", "Client.md"), "utf8");
  }, 30_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("drops symbol-keyed members", () => {
    expect(client).not.toContain("helpersSymbol");
  });

  it("renders members as headings with a signature block instead of a table row", () => {
    expect(client).toContain("### start");
    expect(client).toContain("```ts\nstart: (options) => Promise<void>;\n```");
    expect(client).not.toContain("| Property |");
  });

  it("omits the modifier column from parameter tables", () => {
    expect(client).not.toContain("Modifier");
  });
});
