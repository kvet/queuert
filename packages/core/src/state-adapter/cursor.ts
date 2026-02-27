export type CreatedAtCursor = {
  type: "createdAt";
  id: string;
  createdAt: string;
};

export type ChainIndexCursor = {
  type: "chainIndex";
  id: string;
  chainIndex: number;
};

export const encodeCursor = (payload: CreatedAtCursor | ChainIndexCursor): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

export const decodeCreatedAtCursor = (cursor: string): CreatedAtCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
  if (obj.type === "createdAt" && typeof obj.id === "string" && typeof obj.createdAt === "string") {
    return obj as unknown as CreatedAtCursor;
  }
  throw new Error("Invalid cursor: expected createdAt cursor");
};

export const decodeChainIndexCursor = (cursor: string): ChainIndexCursor => {
  const obj = JSON.parse(Buffer.from(cursor, "base64url").toString()) as Record<string, unknown>;
  if (
    obj.type === "chainIndex" &&
    typeof obj.id === "string" &&
    typeof obj.chainIndex === "number"
  ) {
    return obj as unknown as ChainIndexCursor;
  }
  throw new Error("Invalid cursor: expected chainIndex cursor");
};
