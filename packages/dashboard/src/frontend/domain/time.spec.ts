import { describe, expect, it } from "vitest";

import { formatRelative } from "./time.js";

describe("formatRelative", () => {
  const now = 1_000_000_000;

  it("formats past and future times compactly", () => {
    expect(formatRelative(new Date(now - 40_000), now)).toBe("40s ago");
    expect(formatRelative(new Date(now + 40_000), now)).toBe("in 40s");
    expect(formatRelative(new Date(now - 3 * 3_600_000), now)).toBe("3h ago");
    expect(formatRelative(new Date(now + 2 * 86_400_000), now)).toBe("in 2d");
    expect(formatRelative(new Date(now - 500), now)).toBe("now");
  });
});
