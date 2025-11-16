export type BaseChainDefinitions = Record<
  string,
  {
    input: any;
    output: any;
  }
>;

export const defineUnionChains = <T extends BaseChainDefinitions>() => {
  return {} as T;
};
