import { createSignal } from "solid-js";

import { createHydrated } from "../hydrated.ts";

const storageKey = "queuert-docs:learn-done";

const read = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const [done, setDone] = createSignal<string[]>(read());

const write = (ids: string[]) => {
  setDone(ids);
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {}
};

export const markStepDone = (id: string) => {
  if (!done().includes(id)) write([...done(), id]);
};

export const unmarkStepDone = (id: string) => {
  if (done().includes(id)) write(done().filter((candidate) => candidate !== id));
};

/** Reads as not done until the calling component has hydrated, so it matches the prerendered page. */
export const createStepDone = (): ((id: string) => boolean) => {
  const hydrated = createHydrated();
  return (id) => hydrated() && done().includes(id);
};
