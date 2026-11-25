import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import { Details } from "./Details.tsx";

describe("Details", () => {
  const html = renderToString(() => (
    <Details summary="Schema" hint="12 columns">
      <p id="job-columns">job table columns</p>
    </Details>
  ));

  it("renders a closed native details element", () => {
    expect(html).toMatch(/<details\b/);
    expect(/<details[^>]*\sopen(\s|>|=)/.test(html)).toBe(false);
  });

  it("puts the summary and hint in the summary element", () => {
    const summary = /<summary[\s\S]*<\/summary>/.exec(html)?.[0] ?? "";
    expect(summary).toContain("Schema");
    expect(summary).toContain("12 columns");
  });

  it("renders the folded content into the server HTML", () => {
    const body = html.slice(html.indexOf("</summary>"));
    expect(body).toContain('id="job-columns"');
    expect(body).toContain("job table columns");
  });

  it("omits the hint when none is given", () => {
    const bare = renderToString(() => (
      <Details summary="Indexes">
        <p>index list</p>
      </Details>
    ));
    expect(bare).toContain("index list");
    expect(bare).not.toContain("columns");
  });
});
