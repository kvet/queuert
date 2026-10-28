import { describe, expect, it } from "vitest";

import { shortId } from "./ids.js";

describe("shortId", () => {
  it("keeps IDs of up to 16 characters unchanged", () => {
    expect(shortId("job-42")).toBe("job-42");
    expect(shortId("abcdefghijklmnop")).toBe("abcdefghijklmnop");
  });

  it("shortens longer IDs to first 8 + … + last 4", () => {
    expect(shortId("0193f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f")).toBe("0193f1c2…4e5f");
  });
});
