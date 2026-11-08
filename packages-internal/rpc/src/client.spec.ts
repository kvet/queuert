import { toCrossJSONStream } from "seroval";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerFnClient } from "./client.ts";
import { RpcError } from "./error.ts";
import { errorPlugin } from "./errorPlugin.ts";
import type { ServerFn } from "./server.ts";

const firstRecord = (value: unknown): string => {
  let line = "";
  toCrossJSONStream(value, {
    plugins: [errorPlugin],
    onParse: (node, initial) => {
      if (initial) line = JSON.stringify(node);
    },
  });
  return line;
};

const ndjson = (body: ReadableStream<Uint8Array> | string): Response =>
  new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });

const createClient = () =>
  createServerFnClient<{ probe: ServerFn<undefined, { later: Promise<string> }> }>("./api/rpc");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createServerFnClient", () => {
  it("is not thenable and sends no request when awaited", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = createClient();

    expect(await Promise.resolve(client)).toBe(client);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects with an RpcError when the first record cannot be read", async () => {
    vi.stubGlobal("fetch", async () => ndjson("not json\n"));

    const error: unknown = await createClient()
      .probe()
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).status).toBe(500);
  });

  it("rejects a pending promise when the server closes the response early", async () => {
    vi.stubGlobal("fetch", async () =>
      ndjson(`${firstRecord({ later: new Promise<string>(() => {}) })}\n`),
    );

    const { later } = await createClient().probe();

    await expect(later).rejects.toThrow("The server closed the response early");
  });

  it("rejects a pending promise with the abort reason when the call is aborted mid-stream", async () => {
    const line = new TextEncoder().encode(
      `${firstRecord({ later: new Promise<string>(() => {}) })}\n`,
    );
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
      ndjson(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(line);
            init.signal?.addEventListener("abort", () => {
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        }),
      ),
    );
    const controller = new AbortController();

    const { later } = await createClient().probe({ signal: controller.signal });
    controller.abort();

    await expect(later).rejects.toMatchObject({ name: "AbortError" });
  });
});
