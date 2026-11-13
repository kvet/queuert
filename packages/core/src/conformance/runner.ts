import type { AdapterMode } from "../adapter-mode.ts";

export type ConformanceCase<TContext> = {
  name: string;
  /** The only adapter mode the case runs in; both when omitted. */
  mode?: AdapterMode;
  run: (context: TContext) => Promise<void>;
};

export type ConformanceGroup<TContext> = {
  name: string;
  cases: ConformanceCase<TContext>[];
};
