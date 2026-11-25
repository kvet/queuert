import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import { TaskPanel, TaskProvider, TryIt } from "./TryIt.tsx";

describe("TaskProvider", () => {
  const exercise = {
    lesson: "first-chain",
    start: JSON.stringify({ "index.ts": "" }),
    solution: JSON.stringify({ "index.ts": "" }),
    check: "export const check = () => {};",
    html: JSON.stringify({ "index.ts": "<pre>start</pre>" }),
  };

  it("prerenders the task line and the panel's place without mounting the exercise", () => {
    const html = renderToString(() => (
      <TaskProvider exercise={() => exercise} step>
        <TryIt lesson="first-chain">start a chain</TryIt>
        <TaskPanel />
      </TaskProvider>
    ));

    expect(html).toContain("start a chain");
    expect(html).toContain("data-try-it-panel");
    expect(html).not.toContain("data-exercise");
  });
});
