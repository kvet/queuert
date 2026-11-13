import { describe, expect, it } from "vitest";

import type { SourcePage } from "./content.ts";
import { llmsFullTxt, llmsTxt, pageMarkdown, sitemapXml } from "./site-files.ts";

const html = `<!doctype html><html><body>
<nav>Docs navigation</nav>
<div data-page-content><div class="prose">
<p>Intro <code>createClient</code> and <a href="/queuert/guides/scheduling/">scheduling</a>.</p>
<h2 id="setup">Setup<a class="heading-anchor" href="#setup">#</a></h2>
<section data-code-lang="ts"><header data-box-header><h2>jobs.ts</h2><button>Copy</button></header><div><pre><code>const a = 1;
const b = 2;
</code></pre></div></section>
<ul><li><a href="#setup"><span>pg</span><span>pg · driver</span></a></li><li>Second
line</li></ul>
<figure aria-label="Client writes a job"><div>client</div></figure>
<div><div role="tablist"><button>npm</button></div><div role="tabpanel" data-tab-label="npm"><section data-code-lang="bash"><pre><code>npm install queuert</code></pre></section></div></div>
<h3 id="details">Details</h3>
<p>See <a href="https://example.com/">elsewhere</a>.</p>
</div></div>
</body></html>`;

const page = (slug: string, title: string, description: string | null): SourcePage => ({
  slug,
  file: `${slug}.md`,
  title,
  description,
  layout: "default",
  date: null,
  api: null,
});

describe("pageMarkdown", () => {
  it("renders headings, fenced code with titles, tab labels, lists and absolute links", () => {
    expect(
      pageMarkdown(html, {
        base: "/queuert/",
        pageUrl: "https://kvet.github.io/queuert/guides/setup/",
      }),
    ).toBe(
      [
        "Intro `createClient` and [scheduling](https://kvet.github.io/queuert/guides/scheduling/).",
        "## Setup",
        '```ts title="jobs.ts"\nconst a = 1;\nconst b = 2;\n```',
        "- [pg pg · driver](https://kvet.github.io/queuert/guides/setup/#setup)\n- Second line",
        "Diagram: Client writes a job",
        "**npm**",
        "```bash\nnpm install queuert\n```",
        "### Details",
        "See [elsewhere](https://example.com/).",
      ].join("\n\n"),
    );
  });

  it("fails when the page content root is missing", () => {
    expect(() =>
      pageMarkdown("<p>no content</p>", { base: "/queuert/", pageUrl: "https://x/" }),
    ).toThrow("data-page-content");
  });
});

describe("sitemapXml", () => {
  it("lists every path as an absolute, escaped URL", () => {
    expect(sitemapXml(["/", "/guides/a&b/"])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://kvet.github.io/queuert/</loc></url>",
        "  <url><loc>https://kvet.github.io/queuert/guides/a&amp;b/</loc></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });
});

describe("llmsTxt", () => {
  it("links the pages of each sidebar group in sidebar order, then the API packages", () => {
    const text = llmsTxt([
      page("guides/scheduling", "Scheduling", "Deferred start."),
      page("getting-started/introduction", "Introduction", null),
    ]);

    expect(text.startsWith("# Queuert\n\n> ")).toBe(true);
    expect(text).toContain(
      "## Docs: Getting Started\n- [Introduction](https://kvet.github.io/queuert/getting-started/introduction/)\n\n",
    );
    expect(text).toContain(
      "## Docs: Guides\n- [Scheduling](https://kvet.github.io/queuert/guides/scheduling/): Deferred start.\n\n",
    );
    expect(text).toContain(
      "- [queuert](https://kvet.github.io/queuert/api/core/readme/): Client, worker runner and job types.",
    );
  });
});

describe("llmsFullTxt", () => {
  it("joins pages with their title, source URL and description", () => {
    const text = llmsFullTxt(
      [
        {
          page: page("guides/a", "A", "First."),
          html: "<div data-page-content><p>Alpha.</p></div>",
        },
        { page: page("guides/b", "B", null), html: "<div data-page-content><p>Beta.</p></div>" },
      ],
      { base: "/queuert/" },
    );

    expect(text).toBe(
      [
        "# A\n\nSource: https://kvet.github.io/queuert/guides/a/\n\n> First.\n\nAlpha.",
        "# B\n\nSource: https://kvet.github.io/queuert/guides/b/\n\nBeta.\n",
      ].join("\n\n---\n\n"),
    );
  });
});
