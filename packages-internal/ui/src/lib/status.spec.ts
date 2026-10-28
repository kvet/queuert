import { describe, expect, it } from "vitest";

import { CHAIN_STATUSES, JOB_STATUSES, statusClasses } from "./status.js";

describe("statusClasses", () => {
  it("styles every job and chain status with a pill and a dot", () => {
    for (const status of [...JOB_STATUSES, ...CHAIN_STATUSES]) {
      expect(statusClasses[status].pill).toMatch(/^bg-status-\w+-bg text-status-\w+-fg$/);
      expect(statusClasses[status].dot).toBe(`bg-status-${status}-dot`);
    }
  });
});
