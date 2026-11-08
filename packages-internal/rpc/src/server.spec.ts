import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { RpcError } from "./error.ts";
import { type ServerFn, createServerFnFactory, handleRpc } from "./server.ts";
import { readRpcResponse } from "./testing.ts";

const createServerFn = createServerFnFactory<{ tenant: string }>();

const post = (body: string, contentType = "application/json"): Request =>
  new Request("http://test/rpc", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

const call = (fn: string, data?: unknown): Request => post(JSON.stringify({ fn, data }));

const serve = async (
  request: Request,
  serverFns: Record<string, ServerFn<any, unknown, { tenant: string }>> = {},
): Promise<Response> => handleRpc(request, { tenant: "acme" }, serverFns);

const serveResult = async (result: () => Promise<unknown>): Promise<Response> =>
  serve(call("probe"), { probe: createServerFn().handler(result) });

describe("handleRpc", () => {
  it("passes the context and the validated data to the handler", async () => {
    const greet = createServerFn()
      .inputValidator(v.strictObject({ name: v.string(), times: v.optional(v.number(), 1) }))
      .handler(async ({ data, tenant }) => `${tenant}:${data.name.repeat(data.times)}`);

    const res = await serve(call("greet", { name: "ab", times: 2 }), { greet });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(await readRpcResponse(res)).toBe("acme:abab");
  });

  it("rejects invalid arguments with 400 and names the offending field", async () => {
    const greet = createServerFn()
      .inputValidator(v.strictObject({ name: v.string() }))
      .handler(async ({ data }) => data.name);

    const res = await serve(call("greet", { name: 1 }), { greet });

    expect(res.status).toBe(400);
    expect((await readRpcResponse(res)).error).toContain("data.name");
    expect((await serve(call("greet", { name: "a", extra: 1 }), { greet })).status).toBe(400);
  });

  it("rejects input for a function that takes none with 400", async () => {
    const res = await serve(call("probe", { unexpected: true }), {
      probe: createServerFn().handler(async () => "ok"),
    });

    expect(res.status).toBe(400);
  });

  it("answers an RpcError thrown by a handler with its status and message", async () => {
    const res = await serveResult(async () => {
      throw new RpcError("Chain not found", { status: 404 });
    });

    expect(res.status).toBe(404);
    expect(await readRpcResponse(res)).toEqual({ error: "Chain not found" });
  });

  it("rejects methods other than POST with 405", async () => {
    const res = await serve(new Request("http://test/rpc"));

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("rejects a body that is not declared as JSON with 415", async () => {
    const res = await serve(post(JSON.stringify({ fn: "probe" }), "text/plain"));

    expect(res.status).toBe(415);
  });

  it("rejects a body that is not valid JSON or has no fn with 400", async () => {
    expect((await serve(post("{"))).status).toBe(400);
    expect((await serve(post("[]"))).status).toBe(400);
    expect((await serve(post('{"data":{}}'))).status).toBe(400);
  });

  it("returns 400 for an unknown server function, including inherited property names", async () => {
    const unknownRes = await serve(call("dropEverything"));
    const inheritedRes = await serve(call("toString"));

    expect(unknownRes.status).toBe(400);
    expect(await readRpcResponse(unknownRes)).toEqual({
      error: "Unknown server function: dropEverything",
    });
    expect(inheritedRes.status).toBe(400);
  });
});

describe("streamed results", () => {
  it("resolves a promise in the result later on the same response", async () => {
    let resolveLater: (value: string) => void = () => {};
    const later = new Promise<string>((resolve) => {
      resolveLater = resolve;
    });

    const res = await serveResult(async () => ({ now: "accepted", later }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    resolveLater("done");
    let wire = first;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      wire += decoder.decode(chunk.value);
    }
    const body = await readRpcResponse(new Response(wire, { headers: res.headers }));

    expect(first).toContain("accepted");
    expect(first).not.toContain("done");
    expect(body.now).toBe("accepted");
    expect(await body.later).toBe("done");
  });

  it("sends only the message of an error reached through a Map, Set or class instance", async () => {
    const secretError = () =>
      Object.assign(new Error("boom"), { secret: "s3cr3t", detail: "table job" });
    const rejected = Promise.reject(secretError());
    rejected.catch(() => {});

    const res = await serveResult(async () => ({
      map: new Map([["key", rejected]]),
      set: new Set([secretError()]),
      error: secretError(),
    }));
    const wire = await res.text();
    const body = await readRpcResponse(new Response(wire, { headers: res.headers }));

    expect(res.status).toBe(200);
    expect(wire).not.toContain("s3cr3t");
    expect(wire).not.toContain("table job");
    expect(wire).not.toMatch(/\n\s+at /);
    expect(body.error.message).toBe("boom");
    expect(await body.map.get("key").catch((err: Error) => err.message)).toBe("boom");
  });

  it("streams a result that contains a cycle", async () => {
    const node: { name: string; self?: unknown; later?: Promise<string> } = { name: "root" };
    node.self = node;
    node.later = Promise.resolve("done");

    const body = await readRpcResponse(await serveResult(async () => node));

    expect(body.self).toBe(body);
    expect(await body.later).toBe("done");
  });

  it("fails before the response starts when the result cannot be serialized", async () => {
    class Money {
      cents = 5;
    }

    await expect(serveResult(async () => ({ price: new Money() }))).rejects.toThrow(
      "cannot be parsed/serialized",
    );
  });
});
