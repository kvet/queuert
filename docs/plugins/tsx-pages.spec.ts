import { describe, expect, it } from "vitest";

import { dedent, readPageMeta, transformPage } from "./tsx-pages.ts";

const file = "/content/guides/a.tsx";

const page = (body: string) =>
  `export const meta = { title: "A" };\n\nconst Page = () => (\n  <>\n${body}\n  </>\n);\n\nexport default Page;\n`;

describe("transformPage", () => {
  it("gives h2-h4 slugged ids and anchors, and exports the h2/h3 outline", async () => {
    const { code, headings } = await transformPage(
      page(
        [
          "    <h2>First step</h2>",
          "    <h3>",
          "      Inner <code>detail</code>",
          "    </h3>",
          "    <h4>Too deep</h4>",
          "    <h2>First step</h2>",
        ].join("\n"),
      ),
      file,
    );

    expect(headings).toEqual([
      { depth: 2, text: "First step", id: "first-step" },
      { depth: 3, text: "Inner detail", id: "inner-detail" },
      { depth: 2, text: "First step", id: "first-step-1" },
    ]);
    expect(code).toContain(
      '<h2 id={"first-step"}>First step<a class="heading-anchor" href={"#first-step"}',
    );
    expect(code).toContain('<h4 id={"too-deep"}>');
    expect(code).toContain('<h2 id={"first-step-1"}>');
    expect(code).toContain(`export const headings = ${JSON.stringify(headings)};`);
  });

  it("keeps an explicit heading id and reads text from string expressions", async () => {
    const { code, headings } = await transformPage(
      page('    <h2 id="custom">Options {"{ id }"} &amp; more</h2>'),
      file,
    );

    expect(headings).toEqual([{ depth: 2, text: "Options { id } & more", id: "custom" }]);
    expect(code).toContain('<h2 id="custom">');
    expect(code).toContain('href={"#custom"}');
  });

  it("replaces Code children with the dedented source and highlighted html", async () => {
    const { code } = await transformPage(
      page(
        [
          '    <Code lang="ts" title="client.ts">{`',
          "      const client = await createClient();",
          "",
          "      if (ready) {",
          "        start(\\`\\${name}\\`);",
          "      }",
          "    `}</Code>",
        ].join("\n"),
      ),
      file,
    );

    const source = "const client = await createClient();\n\nif (ready) {\n  start(`${name}`);\n}";
    expect(code).toContain(
      `<Code lang={"ts"} title={"client.ts"} code={${JSON.stringify(source)}} html={`,
    );
    expect(code).toContain("--shiki-token-keyword");
    expect(code).not.toContain("{`");
  });

  it("rejects a Code block whose source is not static", async () => {
    await expect(transformPage(page('    <Code lang="ts">{source}</Code>'), file)).rejects.toThrow(
      "<Code> needs a static lang and a single string child",
    );
  });
});

describe("dedent", () => {
  it("drops the opening newline, trailing indentation and the common indent", () => {
    expect(dedent("\n    a\n\n      b\n  ")).toBe("a\n\n  b");
  });
});

describe("readPageMeta", () => {
  it("reads string fields of the exported meta object", () => {
    expect(
      readPageMeta(
        'export const meta = { title: "Guide", description: "About it.", layout: "wide" };',
        file,
      ),
    ).toEqual({ title: "Guide", description: "About it.", layout: "wide" });
    expect(readPageMeta('export const meta = { title: "Guide" };', file)).toEqual({
      title: "Guide",
      description: null,
      layout: "default",
    });
  });

  it("fails when meta is missing or not static", () => {
    expect(() => readPageMeta("export const other = 1;", file)).toThrow("export const meta");
    expect(() => readPageMeta("export const meta = { title: name };", file)).toThrow(
      "meta.title must be a string literal",
    );
  });
});
