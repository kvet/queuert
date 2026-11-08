import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
import type { Plugin } from "vite";

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

export const examplesDirectory = fileURLToPath(new URL("../../examples", import.meta.url));
export const packagesDirectory = fileURLToPath(new URL("../../packages", import.meta.url));

const regionMarker = /^[ \t]*\/\/ #(region|endregion)\b[ \t]*(\S*)[ \t]*$/;
const hideMarker = /^[ \t]*\/\/ #(hide|endhide)[ \t]*$/;

const dropHidden = (lines: string[], label: string): string[] => {
  const kept: string[] = [];
  let hidden = false;
  for (const line of lines) {
    const kind = hideMarker.exec(line)?.[1];
    if (kind === "hide") {
      if (hidden) throw new Error(`${label}: nested "// #hide"`);
      hidden = true;
    } else if (kind === "endhide") {
      if (!hidden) throw new Error(`${label}: "// #endhide" without "// #hide"`);
      hidden = false;
    } else if (!hidden) kept.push(line);
  }
  if (hidden) throw new Error(`${label}: "// #hide" has no "// #endhide"`);
  return kept;
};

const fileLangs: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".json": "json",
  ".sql": "sql",
  ".prisma": "text",
  ".yaml": "yaml",
  ".yml": "yaml",
};

/**
 * Cuts `// #region <name>` … `// #endregion` out of an example file. Without a region the whole
 * file is returned. Marker lines of any region are dropped from the output either way, and so is
 * everything between `// #hide` and `// #endhide` (code the file needs but the docs elide).
 */
export const extractRegion = (
  source: string,
  region: string | undefined,
  label: string,
): string => {
  const lines = source.split("\n");
  let selected = lines;
  if (region !== undefined) {
    const start = lines.findIndex((line) => {
      const match = regionMarker.exec(line);
      return match?.[1] === "region" && match[2] === region;
    });
    if (start === -1) throw new Error(`${label}: no "// #region ${region}"`);
    let depth = 0;
    let end = -1;
    for (let index = start + 1; index < lines.length; index++) {
      const kind = regionMarker.exec(lines[index])?.[1];
      if (kind === "region") depth++;
      if (kind === "endregion") {
        if (depth === 0) {
          end = index;
          break;
        }
        depth--;
      }
    }
    if (end === -1) throw new Error(`${label}: "// #region ${region}" has no "// #endregion"`);
    selected = lines.slice(start + 1, end);
  }
  return dedent(
    dropHidden(selected, label)
      .filter((line) => !regionMarker.test(line))
      .join("\n"),
  );
};

export type ExampleSource = {
  /** `examples/<example>` or `packages/<package>`, the directory `file` is relative to. */
  root: { kind: "example" | "package"; name: string };
  file: string;
  path: string;
  code: string;
  lang: string;
};

export const readExampleSource = (
  attributes: {
    root: ExampleSource["root"];
    file: string;
    region?: string;
    lang?: string;
  },
  directories: { examples?: string; packages?: string } = {},
): ExampleSource => {
  const { root } = attributes;
  const directory =
    root.kind === "example"
      ? (directories.examples ?? examplesDirectory)
      : (directories.packages ?? packagesDirectory);
  const top = root.kind === "example" ? "examples" : "packages";
  const path = join(directory, root.name, attributes.file);
  if (
    relative(join(directory, root.name), path).startsWith("..") ||
    root.name.includes("/") ||
    root.name.startsWith(".")
  ) {
    throw new Error(`<ExampleCode> file escapes ${top}/: ${root.name}/${attributes.file}`);
  }
  const label = `${top}/${root.name}/${attributes.file}`;
  const source = readFileSync(path, "utf8");
  return {
    root,
    file: attributes.file,
    path,
    code: extractRegion(source, attributes.region, label),
    lang: attributes.lang ?? fileLangs[extname(path)] ?? "text",
  };
};

export const transformPage = async (
  source: string,
  file: string,
  options: { examplesDirectory?: string; packagesDirectory?: string } = {},
): Promise<{ code: string; map: SourceMap; headings: PageHeading[]; dependencies: string[] }> => {
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
  const exampleBlocks: { element: JSXElement; title: string | undefined; source: ExampleSource }[] =
    [];

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
      if (name === "ExampleCode" && !attributeOf(element, "html")) {
        const example = stringAttribute(element, "example");
        const packageName = stringAttribute(element, "package");
        const exampleFile = stringAttribute(element, "file");
        if ((example === undefined) === (packageName === undefined) || exampleFile === undefined) {
          throw new Error(
            `${file}: <ExampleCode> needs a static file and exactly one of example or package`,
          );
        }
        exampleBlocks.push({
          element,
          title: stringAttribute(element, "title"),
          source: readExampleSource(
            {
              root:
                example === undefined
                  ? { kind: "package", name: packageName! }
                  : { kind: "example", name: example },
              file: exampleFile,
              region: stringAttribute(element, "region"),
              lang: stringAttribute(element, "lang"),
            },
            { examples: options.examplesDirectory, packages: options.packagesDirectory },
          ),
        });
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

  for (const { element, title, source: example } of exampleBlocks) {
    const attributes = [
      `lang=${jsxString(example.lang)}`,
      `${example.root.kind}=${jsxString(example.root.name)}`,
      `file=${jsxString(example.file)}`,
      ...(title === undefined ? [] : [`title=${jsxString(title)}`]),
      `code=${jsxString(example.code)}`,
      `html=${jsxString(await highlight(example.code, example.lang))}`,
    ];
    output.overwrite(element.start, element.end, `<ExampleCode ${attributes.join(" ")} />`);
  }

  output.append(`\nexport const headings = ${JSON.stringify(headings)};\n`);
  return {
    code: output.toString(),
    map: output.generateMap({ hires: true, source: file }),
    headings,
    dependencies: exampleBlocks.map((block) => block.source.path),
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
  async transform(source, id) {
    const [file = id] = id.split("?");
    if (!file.startsWith(options.contentDirectory) || !file.endsWith(".tsx")) return;
    const { code, map, dependencies } = await transformPage(source, file);
    for (const dependency of dependencies) this.addWatchFile(dependency);
    return { code, map };
  },
});
