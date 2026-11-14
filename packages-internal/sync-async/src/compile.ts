import { RolldownMagicString } from "rolldown";
import { type ESTree, parseSync } from "rolldown/utils";

import type { Mode } from "./maybe-promise.ts";

export const SYNC_ASYNC_MODULE = "@queuert/sync-async";

const AWAITABLE_AS_IS = new Set([
  "Identifier",
  "ThisExpression",
  "Literal",
  "TemplateLiteral",
  "TaggedTemplateExpression",
  "ArrayExpression",
  "ObjectExpression",
  "ParenthesizedExpression",
  "MemberExpression",
  "ChainExpression",
  "CallExpression",
  "NewExpression",
]);
const OBJECT_LITERAL_SAFE_PARENTS = new Set([
  "VariableDeclarator",
  "Property",
  "ReturnStatement",
  "AssignmentExpression",
  "ArrayExpression",
]);
const YIELD_RULE = "`yield*` in a sync-async body must call `step(...)` or `other.steps(...)`";

type Edit = { start: number; end: number; text: string };
type Names = { syncAsync: string; step?: string; wait?: string; resource?: string };
type Context = {
  code: string;
  id: string;
  identifiers: Set<string>;
  literalNewlines: Set<number>;
  names: Names;
  localSyncAsyncFunctions: Set<string>;
  syncStep: string;
  usesSyncStep: boolean;
};
type Yielded =
  | { kind: "step"; value: ESTree.Expression }
  | { kind: "delegation"; call: ESTree.CallExpression; target: ESTree.Expression };

const isNode = (value: unknown): value is ESTree.Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const childrenOf = (node: ESTree.Node): ESTree.Node[] => {
  const children: ESTree.Node[] = [];
  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item);
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
};

const walk = (
  root: ESTree.Node,
  visit: (node: ESTree.Node, parent: ESTree.Node | null) => boolean | void,
): void => {
  const go = (node: ESTree.Node, parent: ESTree.Node | null): void => {
    if (visit(node, parent) === false) return;
    for (const child of childrenOf(node)) go(child, node);
  };
  go(root, null);
};

const fail = (ctx: Context, node: ESTree.Span, message: string): never => {
  const before = ctx.code.slice(0, node.start).split("\n");
  throw new Error(
    `${ctx.id}:${before.length}:${before.at(-1)!.length + 1}: ${message}: ${ctx.code.slice(node.start, node.end)}`,
  );
};

const indentLines = (ctx: Context, start: number, end: number, indent: string): string => {
  if (indent === "") return ctx.code.slice(start, end);
  let result = "";
  let position = start;
  for (
    let newline = ctx.code.indexOf("\n", start);
    newline !== -1 && newline < end;
    newline = ctx.code.indexOf("\n", newline + 1)
  ) {
    result += ctx.code.slice(position, newline + 1);
    position = newline + 1;
    if (ctx.code[position] !== "\n" && !ctx.literalNewlines.has(newline)) result += indent;
  }
  return result + ctx.code.slice(position, end);
};

const applyEdits = (
  ctx: Context,
  start: number,
  end: number,
  edits: Edit[],
  indent: string,
): string => {
  let result = "";
  let position = start;
  for (const edit of edits.toSorted((a, b) => a.start - b.start)) {
    result += indentLines(ctx, position, edit.start, indent) + edit.text;
    position = edit.end;
  }
  return result + indentLines(ctx, position, end, indent);
};

const lineIndentAt = (code: string, position: number): string => {
  const lineStart = code.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart, position))![0];
};

const needsParentheses = (node: ESTree.Node, parent: ESTree.Node | null): boolean =>
  parent === null ||
  !(
    OBJECT_LITERAL_SAFE_PARENTS.has(parent.type) ||
    ((parent.type === "CallExpression" || parent.type === "NewExpression") &&
      parent.callee !== node)
  );

const syncAsyncBodyOf = (names: Names, node: ESTree.Node): ESTree.Function | undefined => {
  if (
    node.type !== "CallExpression" ||
    node.callee.type !== "Identifier" ||
    node.callee.name !== names.syncAsync ||
    node.arguments.length !== 1
  ) {
    return undefined;
  }
  const [fn] = node.arguments;
  return fn.type === "FunctionExpression" && fn.generator ? fn : undefined;
};

const isStepsMember = (node: ESTree.Node): node is ESTree.StaticMemberExpression =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier" &&
  node.property.name === "steps";

const classifyYield = (ctx: Context, node: ESTree.YieldExpression): Yielded => {
  if (!node.delegate) return fail(ctx, node, "a sync-async body may only use `yield*`");
  const call = node.argument;
  if (call?.type !== "CallExpression" || call.optional) return fail(ctx, node, YIELD_RULE);
  const { callee, arguments: args } = call;

  if (callee.type === "Identifier") {
    if (callee.name === ctx.names.wait || callee.name === ctx.names.resource) {
      return fail(
        ctx,
        node,
        "`wait` and `resource` make a body wait, which only uncompiled bodies (tests) may do",
      );
    }
    if (callee.name === ctx.names.step && args.length === 1 && args[0].type !== "SpreadElement") {
      return { kind: "step", value: args[0] };
    }
  }
  if (isStepsMember(callee) && !callee.optional) {
    return { kind: "delegation", call, target: callee.object };
  }
  return fail(ctx, node, YIELD_RULE);
};

const editsOf = (ctx: Context, root: ESTree.Node, mode: Mode | null, indent: string): Edit[] => {
  const edits: Edit[] = [];
  const visit = (
    node: ESTree.Node,
    parent: ESTree.Node | null,
    inBody: boolean,
    bindingName: string | undefined,
  ): void => {
    const fn = syncAsyncBodyOf(ctx.names, node);
    if (fn !== undefined) {
      const compiled = compileSyncAsyncCall(ctx, node, fn, indent, bindingName);
      edits.push({
        start: node.start,
        end: node.end,
        text: needsParentheses(node, parent) ? `(${compiled})` : compiled,
      });
      return;
    }
    if (node.type === "YieldExpression" && inBody && mode !== null) {
      edits.push({ start: node.start, end: node.end, text: compileYield(ctx, node, mode, indent) });
      return;
    }
    if (
      isStepsMember(node) &&
      node.object.type === "Identifier" &&
      ctx.localSyncAsyncFunctions.has(node.object.name)
    ) {
      return fail(
        ctx,
        node,
        "a compiled sync-async function has no `.steps`: call it only as `yield* other.steps(...)` in a sync-async body",
      );
    }
    const ownsYields = node.type === "FunctionExpression" || node.type === "FunctionDeclaration";
    const childBindingName =
      node.type === "VariableDeclarator" && node.id.type === "Identifier"
        ? node.id.name
        : node.type === "Property" && !node.computed && node.key.type === "Identifier"
          ? node.key.name
          : bindingName;
    for (const child of childrenOf(node)) {
      visit(child, node, inBody && !ownsYields, childBindingName);
    }
  };
  visit(root, null, mode !== null, undefined);
  return edits;
};

const emit = (ctx: Context, root: ESTree.Node, mode: Mode, indent: string): string =>
  applyEdits(ctx, root.start, root.end, editsOf(ctx, root, mode, indent), indent);

const compileYield = (
  ctx: Context,
  node: ESTree.YieldExpression,
  mode: Mode,
  indent: string,
): string => {
  const yielded = classifyYield(ctx, node);

  if (yielded.kind === "step") {
    const value = emit(ctx, yielded.value, mode, indent);
    if (mode === "async") {
      return AWAITABLE_AS_IS.has(yielded.value.type) ? `await ${value}` : `await (${value})`;
    }
    ctx.usesSyncStep = true;
    return `${ctx.syncStep}(${value})`;
  }

  const { call, target } = yielded;
  const argEdits = call.arguments.map((arg) => ({
    start: arg.start,
    end: arg.end,
    text: emit(ctx, arg, mode, indent),
  }));
  const invocation = `${emit(ctx, target, mode, indent)}.${mode}${applyEdits(ctx, call.callee.end, call.end, argEdits, indent)}`;
  if (mode === "async") return `await ${invocation}`;
  ctx.usesSyncStep = true;
  return `${ctx.syncStep}(${invocation})`;
};

const compileSyncAsyncCall = (
  ctx: Context,
  call: ESTree.Node,
  fn: ESTree.Function,
  indent: string,
  bindingName: string | undefined,
): string => {
  if (fn.async)
    return fail(ctx, fn, "a sync-async body must be a generator function, not an async one");
  const fnBody = fn.body!;

  let star = fn.start + "function".length;
  while (ctx.code[star] !== "*") {
    if (/\s/.test(ctx.code[star])) star++;
    else if (ctx.code.startsWith("/*", star)) star = ctx.code.indexOf("*/", star + 2) + 2;
    else if (ctx.code.startsWith("//", star)) star = ctx.code.indexOf("\n", star);
    else return fail(ctx, fn, "unexpected sync-async function head");
  }
  const spaceBeforeStar = /\s/.test(ctx.code[star - 1]);
  const named =
    fn.id === null &&
    bindingName !== undefined &&
    !ctx.identifiers.has(`${bindingName}Sync`) &&
    !ctx.identifiers.has(`${bindingName}Async`);
  let starEnd = star + 1;
  if (spaceBeforeStar || named) while (/[ \t]/.test(ctx.code[starEnd])) starEnd++;

  const base = lineIndentAt(ctx.code, call.start) + indent;
  const inner = `${indent}  `;
  const [syncHead, asyncHead] = ["Sync", "Async"].map((suffix) =>
    applyEdits(
      ctx,
      fn.start,
      fnBody.start,
      [
        {
          start: star,
          end: starEnd,
          text: named ? `${spaceBeforeStar ? "" : " "}${bindingName}${suffix}` : "",
        },
        ...(fn.returnType
          ? [{ start: fn.returnType.start, end: fn.returnType.end, text: "" }]
          : []),
      ],
      inner,
    ),
  );
  return `{\n${base}  sync: ${syncHead}${emit(ctx, fnBody, "sync", inner)},\n${base}  async: async ${asyncHead}${emit(ctx, fnBody, "async", inner)},\n${base}}`;
};

const langOf = (id: string): "js" | "jsx" | "ts" | "tsx" => {
  const path = id.replace(/[?#].*$/, "");
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  return /\.[cm]?ts$/.test(path) ? "ts" : "js";
};

const syncAsyncImports = (program: ESTree.Program): ESTree.ImportDeclaration[] =>
  program.body.flatMap((statement) =>
    statement.type === "ImportDeclaration" &&
    statement.source.value === SYNC_ASYNC_MODULE &&
    statement.importKind !== "type"
      ? [statement]
      : [],
  );

const importedNames = (program: ESTree.Program): Names | undefined => {
  const names: Partial<Names> = {};
  for (const declaration of syncAsyncImports(program)) {
    for (const specifier of declaration.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported =
        specifier.imported.type === "Literal" ? specifier.imported.value : specifier.imported.name;
      if (
        imported === "syncAsync" ||
        imported === "step" ||
        imported === "wait" ||
        imported === "resource"
      ) {
        names[imported] = specifier.local.name;
      }
    }
  }
  const { syncAsync } = names;
  return syncAsync === undefined ? undefined : { ...names, syncAsync };
};

const referencedNames = (program: ESTree.Program): Set<string> => {
  const names = new Set<string>();
  walk(program, (node, parent) => {
    if (node.type === "ImportDeclaration") return false;
    if (node.type !== "Identifier" || parent === null) return;
    const isMemberName =
      parent.type === "MemberExpression" && parent.property === node && !parent.computed;
    const isKey =
      parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand;
    if (!isMemberName && !isKey) names.add(node.name);
  });
  return names;
};

const importEdits = (ctx: Context, program: ESTree.Program, output: string): Edit[] => {
  const referenced = referencedNames(parseSync(ctx.id, output, { lang: langOf(ctx.id) }).program);
  return syncAsyncImports(program).map((declaration, index) => {
    const unnamed: string[] = [];
    const named: string[] = [];
    for (const specifier of declaration.specifiers) {
      const text = ctx.code.slice(specifier.start, specifier.end);
      if (specifier.type !== "ImportSpecifier") unnamed.push(text);
      else if (specifier.importKind === "type" || referenced.has(specifier.local.name)) {
        named.push(text);
      }
    }
    if (index === 0 && ctx.usesSyncStep) named.push(`syncStep as ${ctx.syncStep}`);
    const braced = named.length === 0 ? [] : [`{ ${named.join(", ")} }`];
    const clauses = declaration.specifiers.some(
      (specifier) => specifier.type === "ImportNamespaceSpecifier",
    )
      ? [unnamed, braced]
      : [[...unnamed, ...braced]];
    const text = clauses
      .filter((clause) => clause.length > 0)
      .map((clause) => `import ${clause.join(", ")} from "${SYNC_ASYNC_MODULE}";`)
      .join("\n");
    const end =
      text === "" && ctx.code[declaration.end] === "\n" ? declaration.end + 1 : declaration.end;
    return { start: declaration.start, end, text };
  });
};

export const compileSyncAsyncFunctions = (
  code: string,
  id: string,
): RolldownMagicString | undefined => {
  const { program, errors } = parseSync(id, code, { lang: langOf(id) });
  if (errors.length > 0) return undefined;
  const names = importedNames(program);
  if (names === undefined) return undefined;

  const literalNewlines = new Set<number>();
  const localSyncAsyncFunctions = new Set<string>();
  const identifiers = new Set<string>();
  walk(program, (node) => {
    if (node.type === "Identifier") identifiers.add(node.name);
    if (node.type === "Literal" || node.type === "TemplateElement") {
      for (
        let newline = code.indexOf("\n", node.start);
        newline !== -1 && newline < node.end;
        newline = code.indexOf("\n", newline + 1)
      ) {
        literalNewlines.add(newline);
      }
    }
    if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init !== null &&
      syncAsyncBodyOf(names, node.init) !== undefined
    ) {
      localSyncAsyncFunctions.add(node.id.name);
    }
  });
  let syncStep = "__syncStep";
  for (let suffix = 1; identifiers.has(syncStep); suffix++) syncStep = `__syncStep${suffix}`;

  const ctx: Context = {
    code,
    id,
    identifiers,
    literalNewlines,
    names,
    localSyncAsyncFunctions,
    syncStep,
    usesSyncStep: false,
  };
  const edits = editsOf(ctx, program, null, "");
  if (edits.length === 0) return undefined;
  const output = applyEdits(ctx, 0, code.length, edits, "");
  const compiled = new RolldownMagicString(code);
  for (const { start, end, text } of [...edits, ...importEdits(ctx, program, output)]) {
    if (text === "") compiled.remove(start, end);
    else compiled.overwrite(start, end, text);
  }
  return compiled;
};
