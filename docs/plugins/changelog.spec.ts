import { afterEach, describe, expect, it, vi } from "vitest";

import { loadChangelog, releaseToHtml } from "./changelog.ts";

const release = (
  overrides: Partial<{
    tag_name: string;
    name: string | null;
    published_at: string | null;
    body: string | null;
    draft: boolean;
    prerelease: boolean;
  }>,
) => ({
  tag_name: "v0.12.0",
  name: "v0.12.0",
  published_at: "2026-10-01T10:00:00Z",
  html_url: "https://github.com/kvet/queuert/releases/tag/v0.12.0",
  body: "### Features\n\n- Batch acquisition.",
  draft: false,
  prerelease: false,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("releaseToHtml", () => {
  it("drops the What's changed heading and demotes headings to h3", async () => {
    const { html, sections } = await releaseToHtml(
      "## What's Changed\r\n\r\n# Breaking changes\r\n\r\nRenamed.\r\n\r\n## Features\r\n\r\n#### Details\r\n\r\nMore.",
    );

    expect(html).not.toContain("What's Changed");
    expect(html).not.toMatch(/<h[12]>/);
    expect(html).toContain("<h3>Breaking changes</h3>");
    expect(html).toContain("<h3>Features</h3>");
    expect(html).toContain("<h4>Details</h4>");
    expect(sections).toEqual(["Breaking changes", "Features"]);
  });

  it("highlights fenced code into a release-code block", async () => {
    const { html } = await releaseToHtml("```ts\nconst client = await createClient({});\n```");

    expect(html).toContain('<div class="release-code">');
    expect(html).toContain("shiki");
    expect(html).not.toContain("<pre><code");
  });

  it("keeps http and relative links and drops script links and raw HTML", async () => {
    const { html } = await releaseToHtml(
      [
        "[docs](https://kvet.github.io/queuert/) [guide](/queuert/guides/scheduling/) [anchor](#features)",
        "[click](javascript:alert(1)) [data](data:text/html,hi)",
        '<img src="x" onerror="alert(1)">',
      ].join("\n\n"),
    );

    expect(html).toContain('href="https://kvet.github.io/queuert/"');
    expect(html).toContain('href="/queuert/guides/scheduling/"');
    expect(html).toContain('href="#features"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("onerror");
    expect(html).toContain("click");
  });
});

describe("loadChangelog", () => {
  it("renders published stable releases and skips drafts, prereleases and unpublished ones", async () => {
    vi.stubEnv("CI", "");
    const fetchMock = vi.fn(async () =>
      Response.json([
        release({ name: "", body: "## Breaking Changes\n\n- Renamed a column." }),
        release({ tag_name: "v0.13.0-next.0", prerelease: true }),
        release({ tag_name: "v0.13.0", draft: true }),
        release({ tag_name: "v0.11.0", published_at: null }),
        release({ tag_name: "v0.10.0", name: "Queuert 0.10", body: null }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const changelog = await loadChangelog();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(changelog.unavailable).toBe(false);
    expect(
      changelog.releases.map(({ tag, name, breaking, sections }) => ({
        tag,
        name,
        breaking,
        sections,
      })),
    ).toEqual([
      { tag: "v0.12.0", name: "v0.12.0", breaking: true, sections: ["Breaking Changes"] },
      { tag: "v0.10.0", name: "Queuert 0.10", breaking: false, sections: [] },
    ]);
  });

  it("renders an empty, unavailable changelog when GitHub can't be reached locally", async () => {
    vi.stubEnv("CI", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 })),
    );

    expect(await loadChangelog()).toEqual({ releases: [], unavailable: true });
  });

  it("fails the build in CI when GitHub can't be reached", async () => {
    vi.stubEnv("CI", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(loadChangelog()).rejects.toThrow("fetch failed");
  });
});
