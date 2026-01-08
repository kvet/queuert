import { BaseStateAdapterContext } from "queuert";
import { type Collection } from "mongodb";

export type MongoStateProvider<TContext extends BaseStateAdapterContext> = {
  provideContext: (fn: (context: TContext) => Promise<unknown>) => Promise<unknown>;
  getCollection: (context: TContext) => Collection;
  isInTransaction: (context: TContext) => Promise<boolean>;
  runInTransaction: (
    context: TContext,
    fn: (context: TContext) => Promise<unknown>,
  ) => Promise<unknown>;
};
