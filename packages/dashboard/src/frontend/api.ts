import { RpcError } from "@queuert/rpc";
import { type ServerFnClient, createServerFnClient } from "@queuert/rpc/client";

import type { serverFns as serverFnDefinitions } from "../api/serverFns.ts";
import { MAX_PAGE_LIMIT } from "../shared/limits.ts";

export const PAGE_SIZE: number = MAX_PAGE_LIMIT;

export const serverFns: ServerFnClient<typeof serverFnDefinitions> =
  createServerFnClient("./api/rpc");

export const isNotFound = (error: unknown): boolean =>
  error instanceof RpcError && error.status === 404;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";
