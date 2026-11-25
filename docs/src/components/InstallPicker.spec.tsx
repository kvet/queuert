import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import { InstallPicker, PickedTabs, pickStack } from "./InstallPicker.tsx";
import { TabItem } from "./mdx/Tabs.tsx";

describe("InstallPicker", () => {
  const html = renderToString(() => <InstallPicker />);

  it("prerenders the default stack's command", () => {
    expect(html).toContain('<span style="color:var(--shiki-token-function)">npm</span>');
    expect(html).toContain("> @queuert/postgres</span>");
  });

  it("prerenders each pick as a labelled group with the default option pressed", () => {
    const groups = html.match(/<div[^>]*role="group"[^>]*aria-label="[^"]+"[^>]*>/g) ?? [];
    expect(groups.map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1])).toEqual([
      "State adapter",
      "Notify adapter",
      "Extras",
      "Package manager",
    ]);
    const pressed = [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    );
    expect(pressed).toEqual(["PostgreSQL", "PostgreSQL LISTEN/NOTIFY", "npm"]);
  });

  it("keeps every adapter's note in the page for search", () => {
    for (const link of [
      "/queuert/integrations/state-adapters/postgres/",
      "/queuert/integrations/state-adapters/sqlite/",
      "/queuert/integrations/state-adapters/mysql/",
      "/queuert/integrations/state-adapters/redis/",
      "/queuert/integrations/notify-adapters/postgres/",
      "/queuert/integrations/notify-adapters/redis/",
      "/queuert/integrations/notify-adapters/nats/",
      "/queuert/integrations/notify-adapters/ipc/",
    ]) {
      expect(html).toContain(`href="${link}"`);
    }
  });

  it("prerenders the default stack's tab in PickedTabs", () => {
    const tabs = renderToString(() => (
      <PickedTabs pick="notify">
        <TabItem label="None">
          <p>none</p>
        </TabItem>
        <TabItem label="PostgreSQL LISTEN/NOTIFY">
          <p>listen</p>
        </TabItem>
      </PickedTabs>
    ));
    const panels = tabs.match(/<[^>]*role="tabpanel"[^>]*>/g) ?? [];
    expect(panels.map((tag) => /\shidden(\s|>|=)/.test(tag))).toEqual([true, false]);
  });
});

describe("pickStack", () => {
  const picks = (values: Record<string, string>) => pickStack((syncKey) => values[syncKey]);

  it("defaults to the first option of each pick", () => {
    const stack = picks({});
    expect([stack.state.label, stack.notify.label, stack.manager.label]).toEqual([
      "PostgreSQL",
      "PostgreSQL LISTEN/NOTIFY",
      "npm",
    ]);
  });

  it("falls back to the state adapter's first notify option when the picked one does not fit", () => {
    expect(picks({ state: "SQLite", notify: "Redis" }).notify.label).toBe("IPC");
    expect(picks({ state: "MySQL / MariaDB", notify: "NATS" }).notify.label).toBe("NATS");
  });
});
