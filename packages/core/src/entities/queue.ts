export type BaseQueueDefinitions = Record<
  string,
  {
    input: any;
    output: any;
  }
>;

export const defineUnionQueues = <T extends BaseQueueDefinitions>() => {
  return {} as T;
};

export const queueRefSymbol: unique symbol = Symbol("queueRef");

export type DefineQueueRef<T extends string> = { [queueRefSymbol]: T };
