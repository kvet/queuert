export type BaseQueueDefinitions = Record<
  string,
  {
    input: any;
  }
>;

export const defineUnionQueues = <T extends BaseQueueDefinitions>() => {
  return {} as T;
};
