import { describe, expect, it } from "vitest";

import { decodeIdCursor, decodeTimestampWithIdCursor, encodeCursor } from "./cursor.ts";

describe("cursor", () => {
  it("encodes as unpadded base64url JSON, the format earlier pages were issued in", () => {
    const payload = {
      type: "timestampWithId" as const,
      sortKey: "createdAt",
      value: "2026-11-08T10:00:00.000Z",
      id: "order-ü/?>",
    };

    expect(encodeCursor(payload)).toBe(Buffer.from(JSON.stringify(payload)).toString("base64url"));
    expect(decodeTimestampWithIdCursor(encodeCursor(payload), "createdAt")).toEqual(payload);
  });

  it("round-trips an id cursor", () => {
    expect(decodeIdCursor(encodeCursor({ type: "id", id: "worker-ü" }))).toEqual({
      type: "id",
      id: "worker-ü",
    });
  });

  it("rejects text that is not a cursor", () => {
    expect(() => decodeIdCursor("not a cursor!")).toThrow();
    expect(() => decodeIdCursor(encodeCursor({ type: "id", id: "a" }).slice(0, -3))).toThrow();
  });
});
