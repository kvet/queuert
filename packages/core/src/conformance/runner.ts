export type ConformanceCase<TContext> = {
  name: string;
  run: (context: TContext) => Promise<void>;
};

export type ConformanceGroup<TContext> = {
  name: string;
  cases: ConformanceCase<TContext>[];
};
