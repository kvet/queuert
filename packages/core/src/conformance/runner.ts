import type { Expect } from "./expect.ts";

export type ConformanceCase<TContext> = {
  name: string;
  run: (context: TContext, expect: Expect) => Promise<void>;
};

export type ConformanceGroup<TContext> = {
  name: string;
  cases: ConformanceCase<TContext>[];
};
