import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import { TabItem, Tabs } from "./Tabs.tsx";

describe("Tabs", () => {
  const html = renderToString(() => (
    <Tabs syncKey="logger">
      <TabItem label="Console">
        <p>console output</p>
      </TabItem>
      <TabItem label="Pino" badge="exp">
        <p>pino output</p>
      </TabItem>
      <TabItem label="Winston">
        <p>winston output</p>
      </TabItem>
    </Tabs>
  ));

  const tags = (role: string) => html.match(new RegExp(`<[^>]*role="${role}"[^>]*>`, "g")) ?? [];

  it("prerenders a tab list with the first tab selected", () => {
    expect(tags("tablist")).toHaveLength(1);
    expect(tags("tab").map((tag) => /aria-selected="true"/.test(tag))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("keeps every panel in the page, labelled, with only the selected one shown", () => {
    const panels = tags("tabpanel");
    expect(panels.map((tag) => /data-tab-label="([^"]+)"/.exec(tag)?.[1])).toEqual([
      "Console",
      "Pino",
      "Winston",
    ]);
    expect(panels.map((tag) => /\shidden(\s|>|=)/.test(tag))).toEqual([false, true, true]);
    expect(html).toContain("pino output");
    expect(html).toContain("winston output");
  });

  it("selects the tab named by value", () => {
    const picked = renderToString(() => (
      <Tabs syncKey="logger" value="Winston">
        <TabItem label="Console">
          <p>console output</p>
        </TabItem>
        <TabItem label="Winston">
          <p>winston output</p>
        </TabItem>
      </Tabs>
    ));
    const panels = picked.match(/<[^>]*role="tabpanel"[^>]*>/g) ?? [];
    expect(panels.map((tag) => /\shidden(\s|>|=)/.test(tag))).toEqual([true, false]);
  });
});
