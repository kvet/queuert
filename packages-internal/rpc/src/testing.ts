import { type SerovalNode, createCrossDeserializer } from "seroval";

import { errorPlugin } from "./errorPlugin.ts";

export const readRpcResponse = async (response: Response): Promise<any> => {
  if (!response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
    return response.json();
  }
  const deserializer = createCrossDeserializer({ refs: new Map(), plugins: [errorPlugin] });
  const [first, ...rest] = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SerovalNode);
  const value: unknown = deserializer.deserialize(first);
  for (const node of rest) deserializer.deserialize(node);
  return value;
};
