import { createSignal } from "solid-js";

/** The backends a reader can narrow the benchmark pages to. */
export const backends = [
  { id: "postgres", label: "PostgreSQL" },
  { id: "sqlite", label: "SQLite" },
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "redis", label: "Redis" },
  { id: "nats", label: "NATS" },
  { id: "ipc", label: "IPC" },
  { id: "in-process", label: "In-process" },
] as const;

export type Backend = (typeof backends)[number]["id"];

const stackStorageKey = "queuert-docs:stack";

/** The saved backends, in `backends` order; anything unknown or malformed reads as none. */
export const parseStack = (stored: string | null): Backend[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return backends.flatMap((backend) => (parsed.includes(backend.id) ? [backend.id] : []));
};

/**
 * Runs in `<head>` before the first paint and puts the saved backends on `<html data-stack>`,
 * so `stackStyle` hides the other backends' rows without a flash. No attribute shows every row.
 */
export const stackScript = `(() => {
  try {
    const stored = JSON.parse(localStorage.getItem("${stackStorageKey}") ?? "[]");
    if (Array.isArray(stored) && stored.length > 0) document.documentElement.dataset.stack = stored.join(" ");
  } catch {}
})();`;

/** Hides every element tagged `data-backend` with a backend the reader left out. */
export const stackStyle = backends
  .map(
    (backend) =>
      `:root[data-stack]:not([data-stack~="${backend.id}"]) [data-backend="${backend.id}"] { display: none; }`,
  )
  .join("\n");

const [stack, setStackSignal] = createSignal<Backend[]>([]);

const apply = (next: Backend[]) => {
  if (next.length === 0) delete document.documentElement.dataset.stack;
  else document.documentElement.dataset.stack = next.join(" ");
};

/** The backends the reader picked; empty means every backend is shown. */
export { stack };

export const setStack = (next: Backend[]) => {
  const ordered = parseStack(JSON.stringify(next));
  setStackSignal(ordered);
  try {
    localStorage.setItem(stackStorageKey, JSON.stringify(ordered));
  } catch {}
  apply(ordered);
};

export const initStack = () => {
  try {
    setStackSignal(parseStack(localStorage.getItem(stackStorageKey)));
  } catch {}
  apply(stack());
  window.addEventListener("storage", (event) => {
    if (event.key !== stackStorageKey && event.key !== null) return;
    setStackSignal(parseStack(event.newValue));
    apply(stack());
  });
};

/** Whether a row or series tagged with `backend` is shown under the reader's stack. */
export const shownInStack = (backend: Backend | undefined, picked: Backend[]) =>
  backend === undefined || picked.length === 0 || picked.includes(backend);
