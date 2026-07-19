export type TimestampWithIdCursor = {
  type: "timestampWithId";
  sortKey: string;
  value: string;
  id: string;
};

export type IdCursor = {
  type: "id";
  id: string;
};

export const encodeCursor = (payload: TimestampWithIdCursor | IdCursor): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

export const decodeTimestampWithIdCursor = (
  cursor: string,
  expectedSortKey: string,
): TimestampWithIdCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;

  if (
    obj.type === "timestampWithId" &&
    typeof obj.sortKey === "string" &&
    typeof obj.value === "string" &&
    typeof obj.id === "string"
  ) {
    if (obj.sortKey !== expectedSortKey) {
      throw new Error(
        `Cursor sort key mismatch: cursor was created with "${obj.sortKey}" but current orderBy is "${expectedSortKey}"`,
      );
    }
    return obj as unknown as TimestampWithIdCursor;
  }

  throw new Error("Invalid cursor: expected timestampWithId cursor");
};

export const decodeIdCursor = (cursor: string): IdCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
  if (obj.type === "id" && typeof obj.id === "string") {
    return obj as unknown as IdCursor;
  }
  throw new Error("Invalid cursor: expected id cursor");
};
