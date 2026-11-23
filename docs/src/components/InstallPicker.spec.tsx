import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import { InstallPicker } from "./InstallPicker.tsx";

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
});
