import GithubSlugger from "github-slugger";
import MagicString, { type SourceMap } from "magic-string";
import {
  type Expression,
  type JSXAttribute,
  type JSXChild,
  type JSXElement,
  type Program,
  Visitor,
  parseSync,
} from "oxc-parser";
import { type Plugin } from "vite";

import { highlight } from "./highlight.ts";

type PageHeading = { depth: number; text: string; id: string };

type PageMeta = { title: string; description: string | null; layout: "default" | "wide" };

const parsePage = (source: string, file: string): Program => {
  const result = parseSync(file, source, { lang: "tsx", sourceType: "module" });
  const error = result.errors[0];
  if (error) throw new Error(`${file}: ${error.codeframe ?? error.message}`);
  return result.program;
};

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return entities[entity.toLowerCase()] ?? match;
  });

const jsxTextValue = (raw: string): string => {
  const lines = raw.split(/\r\n|\n|\r/);
  const lastNonEmpty = lines.findLastIndex((line) => /[^ \t]/.test(line));
  return lines
    .map((line, index) => {
      let trimmed = line.replaceAll("\t", " ");
      if (index > 0) trimmed = trimmed.trimStart();
      if (index < lines.length - 1) trimmed = trimmed.trimEnd();
      return trimmed && index !== lastNonEmpty ? `${trimmed} ` : trimmed;
    })
    .join("");
};

const staticString = (
  expression: Expression | { type: "JSXEmptyExpression" },
): string | undefined => {
  if (expression.type === "Literal" && typeof expression.value === "string")
    return expression.value;
  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

const childrenText = (children: JSXChild[]): string =>
  children
    .map((child) => {
      if (child.type === "JSXText") return decodeEntities(jsxTextValue(child.value));
      if (child.type === "JSXExpressionContainer") return staticString(child.expression) ?? "";
      if (child.type === "JSXElement" || child.type === "JSXFragment")
        return childrenText(child.children);
      return "";
    })
    .join("");

const elementName = (element: JSXElement): string | undefined =>
  element.openingElement.name.type === "JSXIdentifier"
    ? element.openingElement.name.name
    : undefined;

const attributeOf = (element: JSXElement, name: string): JSXAttribute | undefined =>
  element.openingElement.attributes.find(
    (attribute): attribute is JSXAttribute =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name,
  );

const stringAttribute = (element: JSXElement, name: string): string | undefined => {
  const value = attributeOf(element, name)?.value;
  if (value?.type === "Literal" && typeof value.value === "string") return value.value;
  if (value?.type === "JSXExpressionContainer") return staticString(value.expression);
  return undefined;
};

export const dedent = (value: string): string => {
  const lines = value
    .replace(/^[ \t]*\n/, "")
    .trimEnd()
    .split("\n");
  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)![0].length),
  );
  return lines
    .map((line) => (line.trim() === "" ? "" : line.slice(Number.isFinite(indent) ? indent : 0)))
    .join("\n");
};

const codeSource = (element: JSXElement): string | undefined => {
  const children = element.children.filter(
    (child) => child.type !== "JSXText" || child.value.trim() !== "",
  );
  const [child] = children;
  if (children.length !== 1 || child?.type !== "JSXExpressionContainer") return undefined;
  const value = staticString(child.expression);
  return value === undefined ? undefined : dedent(value);
};

const jsxString = (value: string) => `{${JSON.stringify(value)}}`;

export const transformPage = async (
  source: string,
  file: string,
): Promise<{ code: string; map: SourceMap; headings: PageHeading[] }> => {
  const program = parsePage(source, file);
  const output = new MagicString(source);
  const slugger = new GithubSlugger();
  const headings: PageHeading[] = [];
  const codeBlocks: {
    element: JSXElement;
    lang: string;
    title: string | undefined;
    code: string;
  }[] = [];

  new Visitor({
    JSXElement: (element) => {
      const name = elementName(element);
      const depth = Number(/^h([2-4])$/.exec(name ?? "")?.[1]);
      if (depth && element.closingElement) {
        const text = childrenText(element.children).replace(/\s+/g, " ").trim();
        const existingId = stringAttribute(element, "id");
        const id = existingId ?? slugger.slug(text);
        if (existingId === undefined) {
          output.appendLeft(element.openingElement.name.end, ` id=${jsxString(id)}`);
        }
        output.appendLeft(
          element.closingElement.start,
          `<a class="heading-anchor" href=${jsxString(`#${id}`)} aria-hidden="true" tabIndex={-1}>#</a>`,
        );
        if (depth <= 3) headings.push({ depth, text, id });
        return;
      }
      if (name !== "Code" || attributeOf(element, "html")) return;
      const lang = stringAttribute(element, "lang");
      const code = codeSource(element);
      if (lang === undefined || code === undefined) {
        throw new Error(`${file}: <Code> needs a static lang and a single string child`);
      }
      codeBlocks.push({ element, lang, title: stringAttribute(element, "title"), code });
    },
  }).visit(program);

  for (const { element, lang, title, code } of codeBlocks) {
    const attributes = [
      `lang=${jsxString(lang)}`,
      ...(title === undefined ? [] : [`title=${jsxString(title)}`]),
      `code=${jsxString(code)}`,
      `html=${jsxString(await highlight(code, lang))}`,
    ];
    output.overwrite(element.start, element.end, `<Code ${attributes.join(" ")} />`);
  }

  output.append(`\nexport const headings = ${JSON.stringify(headings)};\n`);
  return {
    code: output.toString(),
    map: output.generateMap({ hires: true, source: file }),
    headings,
  };
};

export const readPageMeta = (source: string, file: string): PageMeta => {
  const program = parsePage(source, file);
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== "Identifier" || declarator.id.name !== "meta") continue;
      let init = declarator.init;
      while (init?.type === "TSSatisfiesExpression" || init?.type === "TSAsExpression") {
        init = init.expression;
      }
      if (init?.type !== "ObjectExpression") break;
      const fields = new Map<string, string>();
      for (const property of init.properties) {
        if (property.type !== "Property" || property.key.type !== "Identifier") continue;
        const value = staticString(property.value);
        if (value === undefined) {
          throw new Error(`${file}: meta.${property.key.name} must be a string literal`);
        }
        fields.set(property.key.name, value);
      }
      const title = fields.get("title");
      if (title === undefined) break;
      return {
        title,
        description: fields.get("description") ?? null,
        layout: fields.get("layout") === "wide" ? "wide" : "default",
      };
    }
  }
  throw new Error(`${file}: expected \`export const meta = { title: "…" }\``);
};

export const tsxPages = (options: { contentDirectory: string }): Plugin => ({
  name: "queuert:tsx-pages",
  enforce: "pre",
  transform: async (source, id) => {
    const [file = id] = id.split("?");
    if (!file.startsWith(options.contentDirectory) || !file.endsWith(".tsx")) return;
    const { code, map } = await transformPage(source, file);
    return { code, map };
  },
});
