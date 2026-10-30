import { type Client } from "queuert";

import { serovalResponse } from "../response.js";

export const handleWorkersList = async (url: URL, client: Client<any, any>): Promise<Response> => {
  const workers = await client.listWorkers({
    typeName: url.searchParams.get("typeName") ?? undefined,
  });
  return serovalResponse(workers);
};

const decodeWorkerId = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
};

export const handleWorkerDetail = async (
  client: Client<any, any>,
  workerId: string,
): Promise<Response> => {
  const id = decodeWorkerId(workerId);
  const worker = id === undefined ? undefined : await client.getWorker({ id });
  if (!worker) {
    return serovalResponse({ error: "Worker not found" }, 404);
  }
  return serovalResponse({ worker });
};

export const handleWorkerJobs = async (
  client: Client<any, any>,
  workerId: string,
): Promise<Response> => {
  const id = decodeWorkerId(workerId);
  if (id === undefined) return serovalResponse([]);
  const jobs = await client.listWorkerJobs({ workerId: id });
  return serovalResponse(jobs);
};
