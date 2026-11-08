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

const encodeBase64Url = (text: string): string => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const decodeBase64Url = (encoded: string): string =>
  new TextDecoder().decode(
    Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
      char.charCodeAt(0),
    ),
  );

export const encodeCursor = (payload: TimestampWithIdCursor | IdCursor): string =>
  encodeBase64Url(JSON.stringify(payload));

export const decodeTimestampWithIdCursor = (
  cursor: string,
  expectedSortKey: string,
): TimestampWithIdCursor => {
  const obj = JSON.parse(decodeBase64Url(cursor)) as Record<string, unknown>;

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
  const obj = JSON.parse(decodeBase64Url(cursor)) as Record<string, unknown>;
  if (obj.type === "id" && typeof obj.id === "string") {
    return obj as unknown as IdCursor;
  }
  throw new Error("Invalid cursor: expected id cursor");
};
