import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Feature, toCrossJSONStream } from "seroval";

import { RpcError } from "./error.ts";
import { errorPlugin } from "./errorPlugin.ts";

type ServerFnHandler<TContext, TData, TResult> = (
  ctx: TContext & { data: TData },
) => Promise<TResult>;

export type ServerFn<TInput, TResult, TContext = any> = {
  readonly run: (context: TContext, data: unknown) => Promise<TResult>;
  readonly types?: { readonly input: (input: TInput) => TInput; readonly result: TResult };
};

export type CreateServerFn<TContext> = () => {
  inputValidator: <TInput, TData>(
    schema: StandardSchemaV1<TInput, TData>,
  ) => {
    handler: <TResult>(
      handler: ServerFnHandler<TContext, TData, TResult>,
    ) => ServerFn<TInput, TResult, TContext>;
  };
  handler: <TResult>(
    handler: ServerFnHandler<TContext, undefined, TResult>,
  ) => ServerFn<undefined, TResult, TContext>;
};

export const invalidArgument = (path: string, message: string): never => {
  throw new RpcError(`Invalid argument ${path}: ${message}`, { status: 400 });
};

const issuePath = (issue: StandardSchemaV1.Issue): string =>
  [
    "data",
    ...(issue.path ?? []).map((segment) =>
      String(typeof segment === "object" ? segment.key : segment),
    ),
  ].join(".");

const validateWith =
  <TOutput>(schema: StandardSchemaV1<unknown, TOutput>) =>
  async (data: unknown): Promise<TOutput> => {
    const result = await schema["~standard"].validate(data);
    if (result.issues) {
      const [issue] = result.issues;
      return invalidArgument(issuePath(issue), issue.message);
    }
    return result.value;
  };

const noInput = async (data: unknown): Promise<undefined> =>
  data === undefined ? undefined : invalidArgument("data", "expected no input");

const toServerFn =
  <TContext, TData, TResult>(
    validate: (data: unknown) => Promise<TData>,
    handler: ServerFnHandler<TContext, TData, TResult>,
  ): ServerFn<any, TResult, TContext>["run"] =>
  async (context, data) =>
    handler({ ...context, data: await validate(data) });

export const createServerFnFactory =
  <TContext extends object>(): CreateServerFn<TContext> =>
  () => ({
    inputValidator: (schema) => ({
      handler: (handler) => ({ run: toServerFn(validateWith(schema), handler) }),
    }),
    handler: (handler) => ({ run: toServerFn(noInput, handler) }),
  });

export const errorResponse = (error: string, status: number): Response =>
  Response.json({ error }, { status });

const streamResponse = (value: unknown): Response => {
  const encoder = new TextEncoder();
  const pending: Uint8Array[] = [];
  let failure: { error: unknown } | undefined;
  let finished = false;
  let target: ReadableStreamDefaultController<Uint8Array> | undefined;

  const cancel = toCrossJSONStream(value, {
    plugins: [errorPlugin],
    disabledFeatures: Feature.ErrorPrototypeStack,
    onParse: (node) => {
      const line = encoder.encode(`${JSON.stringify(node)}\n`);
      if (target) target.enqueue(line);
      else pending.push(line);
    },
    onError: (error) => {
      if (target) target.error(error);
      else failure = { error };
    },
    onDone: () => {
      if (target) target.close();
      else finished = true;
    },
  });
  if (failure) {
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing the serializer's own error
    throw failure.error;
  }

  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const line of pending) controller.enqueue(line);
      if (finished) controller.close();
      else target = controller;
    },
    cancel: (reason) => {
      cancel(reason);
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const handleRpc = async <TContext>(
  request: Request,
  context: TContext,
  serverFns: Record<string, ServerFn<any, unknown, TContext>>,
): Promise<Response> => {
  if (request.method !== "POST") {
    const response = errorResponse("Method not allowed", 405);
    response.headers.set("Allow", "POST");
    return response;
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return errorResponse("Content-Type must be application/json", 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body is not valid JSON", 400);
  }
  if (!isRecord(body) || typeof body.fn !== "string") {
    return errorResponse("Request body must be { fn: string, data?: unknown }", 400);
  }

  const serverFn = Object.hasOwn(serverFns, body.fn) ? serverFns[body.fn] : undefined;
  if (!serverFn) {
    return errorResponse(`Unknown server function: ${body.fn}`, 400);
  }

  try {
    return streamResponse(await serverFn.run(context, body.data));
  } catch (err) {
    if (err instanceof RpcError) return errorResponse(err.message, err.status);
    throw err;
  }
};
