export type CreatedAtWithIdCursor = {
  type: "createdAtWithId";
  id: string;
  createdAt: string;
};

export type IdCursor = {
  type: "id";
  id: string;
};

export const encodeCursor = (payload: CreatedAtWithIdCursor | IdCursor): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

export const decodeCreatedAtWithIdCursor = (cursor: string): CreatedAtWithIdCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
  if (
    obj.type === "createdAtWithId" &&
    typeof obj.id === "string" &&
    typeof obj.createdAt === "string"
  ) {
    return obj as unknown as CreatedAtWithIdCursor;
  }
  throw new Error("Invalid cursor: expected createdAtWithId cursor");
};

export const decodeIdCursor = (cursor: string): IdCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
  if (obj.type === "id" && typeof obj.id === "string") {
    return obj as unknown as IdCursor;
  }
  throw new Error("Invalid cursor: expected id cursor");
};
