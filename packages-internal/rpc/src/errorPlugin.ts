import { type Plugin, type SerovalNode, createPlugin } from "seroval";

export const errorPlugin: Plugin<Error, { message: SerovalNode }> = createPlugin<
  Error,
  { message: SerovalNode }
>({
  tag: "queuert/rpc/error",
  skipPlainObjects: true,
  test: (value) => value instanceof Error,
  parse: {
    sync: (value, ctx) => ({ message: ctx.parse(value.message) }),
    async: async (value, ctx) => ({ message: await ctx.parse(value.message) }),
    stream: (value, ctx) => ({ message: ctx.parse(value.message) }),
  },
  serialize: (node, ctx) => `new Error(${ctx.serialize(node.message)})`,
  deserialize: (node, ctx) => new Error(ctx.deserialize<string>(node.message)),
});
