import { type SerovalNode, createCrossDeserializer } from "seroval";

import { RpcError } from "./error.ts";
import { errorPlugin } from "./errorPlugin.ts";
import type { ServerFn } from "./server.ts";

const readLines = async function* (body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) yield line;
    }
    if (buffer) yield buffer;
  } finally {
    if (!finished) await reader.cancel();
  }
};

const parseErrorBody = (text: string): string | undefined => {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && "error" in body
      ? String(body.error)
      : undefined;
  } catch {
    return undefined;
  }
};

const errorFromResponse = async (response: Response): Promise<RpcError> => {
  const text = await response.text();
  return new RpcError(parseErrorBody(text) ?? (text.trim() || response.statusText), {
    status: response.status,
  });
};

const NON_SERVER_FN_KEYS = new Set(["then", "toJSON", "toString", "valueOf", "constructor"]);

const callServerFn = async (
  url: string,
  fn: string,
  options: { data?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fn, data: options.data }),
    signal: options.signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body || !response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
    throw new RpcError("Unexpected response from the server", { status: 500 });
  }

  const deserializer = createCrossDeserializer({ refs: new Map(), plugins: [errorPlugin] });
  const lines = readLines(response.body);
  let result: unknown;
  try {
    const first = await lines.next();
    if (first.done) throw new Error("Empty response from the server");
    result = deserializer.deserialize(JSON.parse(first.value) as SerovalNode);
  } catch (err) {
    await lines.return(undefined);
    if (options.signal?.aborted) throw err;
    throw new RpcError("Unreadable response from the server", { status: 500, cause: err });
  }

  void (async () => {
    try {
      for await (const line of lines) deserializer.deserialize(JSON.parse(line) as SerovalNode);
      if (deserializer.pending > 0) {
        deserializer.abort(new RpcError("The server closed the response early", { status: 500 }));
      }
    } catch (err) {
      deserializer.abort(
        options.signal?.aborted
          ? err
          : new RpcError("Unreadable response from the server", { status: 500, cause: err }),
      );
    }
  })();

  return result;
};

export type ClientFn<TServerFn> =
  TServerFn extends ServerFn<infer TInput, infer TResult>
    ? undefined extends TInput
      ? (options?: { data?: TInput; signal?: AbortSignal }) => Promise<TResult>
      : (options: { data: TInput; signal?: AbortSignal }) => Promise<TResult>
    : never;

export type ServerFnClient<TServerFns> = { [K in keyof TServerFns]: ClientFn<TServerFns[K]> };

export const createServerFnClient = <TServerFns extends Record<string, ServerFn<any, unknown>>>(
  url: string,
): ServerFnClient<TServerFns> =>
  new Proxy({} as ServerFnClient<TServerFns>, {
    get: (_, fn) =>
      typeof fn === "string" && !NON_SERVER_FN_KEYS.has(fn)
        ? async (options?: { data?: unknown; signal?: AbortSignal }) =>
            callServerFn(url, fn, options)
        : undefined,
  });
