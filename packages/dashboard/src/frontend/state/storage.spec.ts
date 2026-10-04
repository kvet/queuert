import { describe, expect, it } from "vitest";

import { storageKey } from "./storage.js";

describe("storageKey", () => {
  it("namespaces preferences by mount path", () => {
    expect(storageKey("", "theme")).toBe("queuert-dashboard:/:theme");
    expect(storageKey("/internal/queuert", "theme")).toBe(
      "queuert-dashboard:/internal/queuert:theme",
    );
    expect(storageKey("/internal/queuert", "refresh")).toBe(
      "queuert-dashboard:/internal/queuert:refresh",
    );
  });
});
