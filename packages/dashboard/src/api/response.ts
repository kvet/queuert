// @ts-expect-error tsgo doesn't resolve export * re-exports from seroval
import { serialize } from "seroval";

export const serovalResponse = (data: unknown, status = 200): Response =>
  new Response(serialize(data), {
    status,
    headers: { "Content-Type": "application/x-seroval" },
  });
