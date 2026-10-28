import { describe, expect, it } from "vitest";

import { type SourcePage } from "./content.ts";
import { pageIndex, pageSearchEntries, pageSections } from "./search-index.ts";

const html = `<!doctype html><html><body>
<nav>Docs navigation</nav>
<div data-page-content><div class="prose">
<p>Intro <code>text</code>.</p>
<section data-code-lang="ts"><header data-box-header><h2>TypeScript</h2><button>Copy</button></header><div><pre><code>const hidden = 1;</code></pre></div></section>
<h2 id="setup">Setup<a class="heading-anchor" href="#setup">#</a></h2>
<ul><li>First</li><li>Second</li></ul>
<figure class="q-d" aria-label="Client writes a job"><div>client</div><div>job</div></figure>
<div><div role="tablist"><button>npm</button></div><div role="tabpanel" data-tab-label="npm"><p>Run npm.</p></div><div role="tabpanel" hidden data-tab-label="pnpm"><p>Run pnpm.</p></div></div>
<h4 id="details">Details</h4>
<p>Deep.</p>
</div></div>
</body></html>`;

const page: SourcePage = {
  slug: "guides/setup",
  file: "guides/setup.tsx",
  title: "Setup guide",
  description: "How to set up.",
  layout: "default",
  api: null,
};

describe("pageSections", () => {
  it("splits the page content at h2-h4 ids and skips code, anchors and tab buttons", () => {
    expect(pageSections(html)).toEqual([
      { heading: "", id: "", text: "Intro text." },
      {
        heading: "Setup",
        id: "setup",
        text: "First Second Diagram: Client writes a job Run npm. Run pnpm.",
      },
      { heading: "Details", id: "details", text: "Deep." },
    ]);
  });

  it("fails when the page content root is missing", () => {
    expect(() => pageSections("<p>no content</p>")).toThrow("data-page-content");
  });
});

describe("pageSearchEntries", () => {
  it("links sections to heading anchors and prefixes the intro with the description", () => {
    const entries = pageSearchEntries(page, html);

    expect(entries[0]).toEqual({
      title: "Setup guide",
      heading: "",
      section: "Docs",
      href: "/guides/setup/",
      text: "How to set up. Intro text.",
    });
    expect(entries.map((entry) => entry.href)).toEqual([
      "/guides/setup/",
      "/guides/setup/#setup",
      "/guides/setup/#details",
    ]);
  });

  it("caps long section text at a word boundary", () => {
    const long = `<div data-page-content><h2 id="long">Long</h2><p>${"word ".repeat(400)}</p></div>`;
    const [, entry] = pageSearchEntries(page, long);

    expect(entry?.text.length).toBeLessThanOrEqual(702);
    expect(entry?.text.endsWith("word …")).toBe(true);
  });

  it("cuts long section text without spaces at the length cap", () => {
    const long = `<div data-page-content><h2 id="long">Long</h2><p>${"x".repeat(900)}</p></div>`;
    const [, entry] = pageSearchEntries(page, long);

    expect(entry?.text).toBe(`${"x".repeat(700)} …`);
  });

  it("indexes anchored list rows as their own entries and keeps only their names in the section", () => {
    const rows = `<div data-page-content><h2 id="events">Events</h2><p>Every event.</p>
<ul class="row-list">
<li id="event-job_attempt_lost"><div><a href="#event-job_attempt_lost">job_attempt_lost</a> <span>warn</span></div><div>The attempt was lost.</div></li>
<li id="event-job_completed"><div><a href="#event-job_completed">job_completed</a></div><div>${"done ".repeat(200)}</div></li>
<li id="unrelated"><a href="#elsewhere">Plain</a> item</li>
</ul></div>`;
    const entries = pageSearchEntries(page, rows);

    expect(pageIndex(rows).sections[1]).toEqual({
      heading: "Events",
      id: "events",
      text: "Every event. job_attempt_lost job_completed Plain item",
    });
    expect(entries.slice(-2)).toEqual([
      {
        title: "Setup guide",
        heading: "job_attempt_lost",
        section: "Docs",
        href: "/guides/setup/#event-job_attempt_lost",
        text: "warn The attempt was lost.",
      },
      expect.objectContaining({
        heading: "job_completed",
        href: "/guides/setup/#event-job_completed",
      }),
    ]);
    expect(entries.at(-1)?.text.endsWith("done …")).toBe(true);
  });
});
