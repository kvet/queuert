import { describe, expect, it } from "vitest";

import { dashboardStorageKey } from "./dashboard-storage.ts";

describe("dashboardStorageKey", () => {
  it("namespaces preferences by mount path", () => {
    expect(dashboardStorageKey("", "theme")).toBe("queuert-dashboard:/:theme");
    expect(dashboardStorageKey("/internal/queuert", "theme")).toBe(
      "queuert-dashboard:/internal/queuert:theme",
    );
  });
});
