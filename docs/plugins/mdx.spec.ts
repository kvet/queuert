import { compile } from "@mdx-js/mdx";
import { VFile } from "vfile";
import { describe, expect, it } from "vitest";

import { mdxOptions, pageSlug } from "./mdx.ts";

const contentDirectory = "/content";

const compilePage = async (path: string, value: string): Promise<string> =>
  String(
    await compile(
      new VFile({ path: `${contentDirectory}/${path}`, value }),
      mdxOptions({ contentDirectory, base: "/queuert/" }),
    ),
  );

describe("pageSlug", () => {
  it("drops the extension and index, and lowercases generated file names", () => {
    expect(pageSlug("guides/timeouts.md")).toBe("guides/timeouts");
    expect(pageSlug("guides/timeouts.tsx")).toBe("guides/timeouts");
    expect(pageSlug("guides/scheduling.mdx")).toBe("guides/scheduling");
    expect(pageSlug("comparison/index.tsx")).toBe("comparison");
    expect(pageSlug("index.tsx")).toBe("");
    expect(pageSlug("api/core/type-aliases/Client.md")).toBe("api/core/type-aliases/client");
  });
});

describe("mdxOptions", () => {
  it("renders markdown elements as intrinsic JSX so Solid compiles them to templates", async () => {
    const output = await compilePage("guides/a.md", "Some *text* here.");

    expect(output).toContain("<p>");
    expect(output).toContain("<em>");
    expect(output).not.toContain("_components.p");
  });

  it("assigns heading ids and exports the h2/h3 outline", async () => {
    const output = await compilePage(
      "guides/a.md",
      "## First step\n\n### Inner detail\n\n#### Too deep\n\n## First step",
    );

    expect(output).toMatch(
      /export const headings = \[\{\s*"depth": 2,\s*"text": "First step",\s*"id": "first-step"\s*\}/,
    );
    expect(output).toContain('"id": "inner-detail"');
    expect(output).toContain('"id": "first-step-1"');
    expect(output).not.toContain('"text": "Too deep"');
    expect(output).toContain('<h4 id="too-deep">');
  });

  it("drops the leading h1, since the page layout renders the title", async () => {
    const output = await compilePage("api/core/README.md", "# queuert\n\nBody text.");

    expect(output).not.toContain("<h1");
    expect(output).toContain("Body text.");
  });

  it("rewrites relative markdown links to site URLs", async () => {
    const output = await compilePage(
      "api/core/type-aliases/Client.md",
      "See [createClient](../functions/createClient.md) and [jobId](JobView.md#jobid).",
    );

    expect(output).toContain('href="/queuert/api/core/functions/createclient/"');
    expect(output).toContain('href="/queuert/api/core/type-aliases/jobview/#jobid"');
  });

  it("links a top-level index page without a doubled slash", async () => {
    const output = await compilePage(
      "guides/a.md",
      "[Home](../index.md) and [Compare](../comparison/index.md#at-a-glance)",
    );

    expect(output).toContain('href="/queuert/"');
    expect(output).toContain('href="/queuert/comparison/#at-a-glance"');
  });

  it("leaves absolute and external links alone", async () => {
    const output = await compilePage(
      "guides/a.md",
      "[Blockers](/queuert/guides/job-blockers/) and [GitHub](https://github.com/kvet/queuert/blob/main/README.md)",
    );

    expect(output).toContain('href="/queuert/guides/job-blockers/"');
    expect(output).toContain('href="https://github.com/kvet/queuert/blob/main/README.md"');
  });

  it("highlights fenced code into a Code block with the raw source and title", async () => {
    const output = await compilePage(
      "guides/a.md",
      '```ts title="client.ts"\nconst client = await createClient();\n```',
    );

    expect(output).toContain('<Code lang="ts"');
    expect(output).toContain('title="client.ts"');
    expect(output).toContain('code="const client = await createClient();"');
    expect(output).toContain("--shiki-token-keyword");
  });
});

describe("guide pages", () => {
  it("drops YAML frontmatter instead of rendering it", async () => {
    const output = await compilePage(
      "guides/a.md",
      "---\ntitle: Timeouts\nsidebar:\n  order: 8\n---\n\nBody text.",
    );

    expect(output).not.toContain("Timeouts");
    expect(output).not.toContain("<hr");
    expect(output).toContain("Body text.");
  });

  it("turns :::note and :::tip blocks into Aside elements", async () => {
    const output = await compilePage(
      "guides/a.md",
      "Before.\n\n:::tip\nSee [State Adapters](/queuert/integrations/state-adapters/).\n:::\n\n:::caution[Careful]\n\nFirst.\n\nSecond.\n\n:::",
    );

    expect(output).toContain('<Aside type="tip">');
    expect(output).toContain('<Aside type="caution" title="Careful">');
    expect(output).toContain('href="/queuert/integrations/state-adapters/"');
    expect(output).toContain("First.");
    expect(output).toContain("Second.");
    expect(output).not.toContain(":::");
  });

  it("fails on an aside without a closing marker", async () => {
    await expect(compilePage("guides/a.md", ":::note\nNo end.")).rejects.toThrow(
      "Unclosed :::note aside",
    );
  });

  it("renders tables as labelled rows instead of table markup", async () => {
    const output = await compilePage(
      "advanced/a.md",
      "| Column | Type | Description |\n| --- | --- | --- |\n| `id` | `TEXT` | Job identifier |",
    );

    expect(output).not.toContain("<table");
    expect(output).toContain('<TableRows columns="3">');
    expect(output).toContain('<TableCell label="Column" role="name">');
    expect(output).toContain('<TableCell label="Type" role="field">');
    expect(output).toContain('<TableCell label="Description" role="description">');
  });

  it("imports relative images so the bundler emits them", async () => {
    const output = await compilePage(
      "integrations/a.mdx",
      "![Overview](../../../assets/dashboard/overview.png)\n\n![Remote](https://example.com/a.png)",
    );

    expect(output).toContain('import _image0 from "../../../assets/dashboard/overview.png"');
    expect(output).toContain('<img src={_image0} alt="Overview" loading="lazy" />');
    expect(output).toContain('src="https://example.com/a.png"');
  });
});

describe("API pages", () => {
  it("renders parameter tables as field rows, nesting dotted names under their parent", async () => {
    const output = await compilePage(
      "api/core/functions/createClient.md",
      [
        "## Parameters",
        "",
        "| Parameter | Type | Description |",
        "| :------ | :------ | :------ |",
        "| `options` | \\{ `log?`: `Log`; \\} | Client configuration. |",
        "| `options.log?` | `Log` | Optional log function. |",
      ].join("\n"),
    );

    expect(output).not.toContain("<table");
    expect(output).toContain("<ApiFields>");
    expect(output).toMatch(/<ApiField name="options">\s*<ApiFieldType><code>\{"object"\}<\/code>/);
    expect(output).toContain('<ApiField name="log" parent="options." optional="true">');
    expect(output).toContain("Optional log function.");
  });

  it("titles field rows with their sub-heading and hides placeholder columns", async () => {
    const output = await compilePage(
      "api/core/type-aliases/Client.md",
      [
        "### awaitChain",
        "",
        "#### Type Parameters",
        "",
        "| Type Parameter | Default type |",
        "| :------ | :------ |",
        "| `TName` *extends* `string` | - |",
      ].join("\n"),
    );

    expect(output).toContain('<ApiFields title="Type Parameters">');
    expect(output).toContain('<em>{"extends"}</em>');
    expect(output).not.toContain("ApiFieldDefault");
  });

  it("merges repeated Throws sections into one list", async () => {
    const output = await compilePage(
      "api/core/type-aliases/Client.md",
      [
        "### getChain",
        "",
        "#### Throws",
        "",
        "First.",
        "",
        "#### Throws",
        "",
        "Second.",
        "",
        "***",
      ].join("\n"),
    );

    expect(output.match(/ApiSection title="Throws"/g)).toHaveLength(1);
    expect(output).toContain('<li>{"First."}</li>');
    expect(output).toContain('<li>{"Second."}</li>');
    expect(output).not.toContain("<hr");
  });

  it("collapses plain properties into field rows and keeps methods as headed members", async () => {
    const output = await compilePage(
      "api/core/type-aliases/Config.md",
      [
        "## Properties",
        "",
        "### multiplier?",
        "",
        "```ts",
        "optional multiplier?: number;",
        "```",
        "",
        "Backoff multiplier.",
        "",
        "#### Default",
        "",
        "```ts",
        "2",
        "```",
        "",
        "***",
        "",
        "### start",
        "",
        "```ts",
        "start: () => void;",
        "```",
        "",
        "Start it.",
        "",
        "#### Returns",
        "",
        "`void`",
      ].join("\n"),
    );

    expect(output).toContain('<ApiField name="multiplier" id="multiplier" optional="true">');
    expect(output).toContain('<ApiFieldDefault><code>{"2"}</code></ApiFieldDefault>');
    expect(output).not.toContain('"text": "multiplier?"');
    expect(output).toContain('"text": "start"');
    expect(output).toContain('code="start: () => void;"');
    expect(output).toContain('signature="true"');
  });

  it("keeps properties with a type declaration as headed members with field rows", async () => {
    const output = await compilePage(
      "api/conformance/type-aliases/Fixture.md",
      [
        "## Properties",
        "",
        "### basic",
        "",
        "```ts",
        "basic: object;",
        "```",
        "",
        "| Name | Type | Description |",
        "| :------ | :------ | :------ |",
        "| `build()` | () => `void` | Builds it. |",
      ].join("\n"),
    );

    expect(output).toContain('"text": "basic"');
    expect(output).toContain('<ApiField name="build()">');
    expect(output).not.toContain("<table");
  });

  it("gives class pages a class signature and a single Constructor section", async () => {
    const output = await compilePage(
      "api/core/classes/JobNotFoundError.md",
      [
        "# Class: JobNotFoundError",
        "",
        "**`Experimental`**",
        "",
        "Thrown when a job is missing.",
        "",
        "## Extends",
        "",
        "- `Error`",
        "",
        "## Constructors",
        "",
        "### Constructor",
        "",
        "```ts",
        "new JobNotFoundError(message): JobNotFoundError;",
        "```",
        "",
        "#### Returns",
        "",
        "`JobNotFoundError`",
        "",
        "#### Overrides",
        "",
        "```ts",
        "Error.constructor",
        "```",
      ].join("\n"),
    );

    expect(output).toContain('code="class JobNotFoundError extends Error"');
    expect(output).toContain('"text": "Constructor"');
    expect(output).not.toContain('"text": "Extends"');
    expect(output).not.toContain("Error.constructor");
    expect(output).not.toContain('title="Returns"');
    expect(output).not.toContain("Experimental");
  });
});
