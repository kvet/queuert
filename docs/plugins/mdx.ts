import { posix } from "node:path";

import { type CompileOptions } from "@mdx-js/mdx";
import { type Node, type Program } from "estree-jsx";
import { valueToEstree } from "estree-util-value-to-estree";
import { visit as visitEstree } from "estree-util-visit";
import GithubSlugger from "github-slugger";
import { type Element, type ElementContent, type Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import {
  type ListItem,
  type PhrasingContent,
  type Root as MdastRoot,
  type RootContent,
  type Table,
} from "mdast";
import {
  type MdxJsxAttribute,
  type MdxJsxFlowElement,
  type MdxJsxFlowElementHast,
} from "mdast-util-mdx-jsx";
import { type MdxjsEsmHast } from "mdast-util-mdxjs-esm";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";
import { type VFile } from "vfile";

import { highlight } from "./highlight.ts";

export const pageSlug = (file: string): string =>
  file
    .replace(/\.(mdx?|tsx)$/, "")
    .replace(/(^|\/)index$/, "")
    .toLowerCase();

const attribute = (name: string, value: string): MdxJsxAttribute => ({
  type: "mdxJsxAttribute",
  name,
  value,
});

const remarkStripTitle = () => (tree: MdastRoot) => {
  const index = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1);
  if (index !== -1) tree.children.splice(index, 1);
};

const remarkRelativeLinks =
  (options: { contentDirectory: string; base: string }) => (tree: MdastRoot, file: VFile) => {
    const page = posix.relative(options.contentDirectory, file.path);
    visit(tree, "link", (node) => {
      const match = /^([^:#?]+\.mdx?)(#.*)?$/.exec(node.url);
      if (!match) return;
      const slug = pageSlug(posix.normalize(posix.join(posix.dirname(page), match[1])));
      node.url = `${options.base}${slug === "" ? "" : `${slug}/`}${match[2] ?? ""}`;
    });
  };

const isApiPage = (contentDirectory: string, file: VFile) =>
  posix.relative(contentDirectory, file.path).startsWith("api/");

const asideOpen = /^:::(note|tip|caution|danger)(?:\[([^\]\n]*)\])?(?:\n|$)/;
const asideClose = /(?:^|\n):::$/;

const stripAsideClose = (node: RootContent): boolean => {
  if (node.type !== "paragraph") return false;
  const last = node.children.at(-1);
  if (last?.type !== "text" || !asideClose.test(last.value)) return false;
  last.value = last.value.replace(asideClose, "");
  if (last.value === "") node.children.pop();
  return true;
};

const remarkAsides = () => (tree: MdastRoot) => {
  visit(tree, "paragraph", (node, index, parent) => {
    const [first] = node.children;
    if (parent === undefined || index === undefined || first?.type !== "text") return;
    const open = asideOpen.exec(first.value);
    if (!open) return;
    first.value = first.value.slice(open[0].length);
    if (first.value === "") node.children.shift();
    let end = index;
    while (end < parent.children.length && !stripAsideClose(parent.children[end])) end++;
    if (end === parent.children.length) {
      throw new Error(`Unclosed :::${open[1]} aside`);
    }
    const body = parent.children
      .slice(index, end + 1)
      .filter((child) => child.type !== "paragraph" || child.children.length > 0);
    parent.children.splice(
      index,
      end - index + 1,
      flowElement(
        "Aside",
        [attribute("type", open[1]), ...(open[2] ? [attribute("title", open[2])] : [])],
        body,
      ) as (typeof parent.children)[number],
    );
    return [SKIP, index + 1];
  });
};

const remarkTables = (options: { contentDirectory: string }) => (tree: MdastRoot, file: VFile) => {
  if (isApiPage(options.contentDirectory, file)) return;
  visit(tree, "table", (node, index, parent) => {
    if (parent === undefined || index === undefined) return;
    const [header, ...rows] = node.children;
    const columns = (header?.children ?? []).map((cell) => mdastToString(cell).trim());
    const role = (column: number) =>
      column === 0 ? "name" : column === columns.length - 1 ? "description" : "field";
    parent.children[index] = flowElement(
      "TableRows",
      [attribute("columns", String(columns.length))],
      rows.map((row) =>
        flowElement(
          "TableRow",
          [],
          row.children.map((cell, column) =>
            flowElement(
              "TableCell",
              [attribute("label", columns[column] ?? ""), attribute("role", role(column))],
              cell.children as RootContent[],
            ),
          ),
        ),
      ),
    );
    return SKIP;
  });
};

const identifierExpression = (name: string): Program => ({
  type: "Program",
  sourceType: "module",
  body: [{ type: "ExpressionStatement", expression: { type: "Identifier", name } }],
});

const defaultImport = (name: string, source: string): MdxjsEsmHast => ({
  type: "mdxjsEsm",
  value: "",
  data: {
    estree: {
      type: "Program",
      sourceType: "module",
      body: [
        {
          type: "ImportDeclaration",
          specifiers: [{ type: "ImportDefaultSpecifier", local: { type: "Identifier", name } }],
          source: { type: "Literal", value: source },
          attributes: [],
        },
      ],
    },
  },
});

const remarkImageImports = () => (tree: MdastRoot) => {
  const imports: MdxjsEsmHast[] = [];
  visit(tree, "image", (node, index, parent) => {
    if (parent === undefined || index === undefined || /^([a-z]+:|\/|#)/i.test(node.url)) return;
    const name = `_image${imports.length}`;
    imports.push(defaultImport(name, node.url));
    parent.children[index] = {
      type: "mdxJsxTextElement",
      name: "img",
      attributes: [
        {
          type: "mdxJsxAttribute",
          name: "src",
          value: {
            type: "mdxJsxAttributeValueExpression",
            value: name,
            data: { estree: identifierExpression(name) },
          },
        },
        attribute("alt", node.alt ?? ""),
        attribute("loading", "lazy"),
      ],
      children: [],
    };
  });
  tree.children.unshift(...(imports as unknown as RootContent[]));
};

const headingText = (node: RootContent | undefined): string | undefined =>
  node?.type === "heading" ? mdastToString(node) : undefined;

const sectionEnd = (children: RootContent[], start: number, depth: number): number => {
  let end = start + 1;
  while (end < children.length) {
    const node = children[end];
    if (node.type === "heading" && node.depth <= depth) break;
    end++;
  }
  return end;
};

const flowElement = (
  name: string,
  attributes: MdxJsxAttribute[],
  children: RootContent[],
): MdxJsxFlowElement => ({
  type: "mdxJsxFlowElement",
  name,
  attributes,
  children: children as MdxJsxFlowElement["children"],
});

const trimLeadingSpace = (nodes: PhrasingContent[]): PhrasingContent[] => {
  const [first, ...rest] = nodes;
  if (first?.type !== "text") return nodes;
  const value = first.value.trimStart();
  return value === "" ? rest : [{ ...first, value }, ...rest];
};

const typeBreakAfter = /([<(|,&])/;

const breakableType = (nodes: PhrasingContent[]): PhrasingContent[] =>
  nodes.flatMap((node): PhrasingContent[] =>
    node.type === "text"
      ? node.value
          .split(typeBreakAfter)
          .filter((part) => part !== "")
          .flatMap((part): PhrasingContent[] => [
            { type: "text", value: part },
            ...(typeBreakAfter.test(part)
              ? [{ type: "mdxJsxTextElement" as const, name: "wbr", attributes: [], children: [] }]
              : []),
          ])
      : [node],
  );

const isPlaceholder = (nodes: PhrasingContent[]): boolean =>
  ["", "-", "—"].includes(mdastToString({ type: "paragraph", children: nodes }).trim());

const tableFields = (table: Table, title: string | undefined): MdxJsxFlowElement => {
  const [header, ...rows] = table.children;
  const columns = (header?.children ?? []).map((cell) => mdastToString(cell).trim());
  const names = rows.map((row) => {
    const nameCode = row.children[0]?.children.find((child) => child.type === "inlineCode");
    return nameCode?.type === "inlineCode" ? nameCode.value : mdastToString(row.children[0]);
  });
  const fields = rows.map((row, rowIndex) => {
    const fullName = names[rowIndex];
    const optional = fullName.endsWith("?");
    const path = optional ? fullName.slice(0, -1) : fullName;
    const separator = path.lastIndexOf(".");
    const nameCell = row.children[0]?.children ?? [];
    const nameIndex = nameCell.findIndex((child) => child.type === "inlineCode");
    const constraint = trimLeadingSpace(nameCell.slice(nameIndex + 1));
    const cell = (label: string): PhrasingContent[] => {
      const column = columns.indexOf(label);
      const content = column === -1 ? [] : (row.children[column]?.children ?? []);
      return isPlaceholder(content) ? [] : content;
    };
    const hasNestedFields = names.some((candidate) => candidate.startsWith(`${path}.`));
    const type: PhrasingContent[] = hasNestedFields
      ? [{ type: "inlineCode", value: "object" }]
      : [...constraint, ...cell("Type")];
    const defaultType = cell("Default type");
    const description = cell("Description");
    return flowElement(
      "ApiField",
      [
        attribute("name", path.slice(separator + 1)),
        ...(separator === -1 ? [] : [attribute("parent", path.slice(0, separator + 1))]),
        ...(optional ? [attribute("optional", "true")] : []),
      ],
      [
        ...(type.length > 0 ? [flowElement("ApiFieldType", [], breakableType(type))] : []),
        ...(defaultType.length > 0
          ? [flowElement("ApiFieldDefault", [], breakableType(defaultType))]
          : []),
        ...(description.length > 0 ? [flowElement("ApiFieldDescription", [], description)] : []),
      ],
    );
  });
  return flowElement("ApiFields", title === undefined ? [] : [attribute("title", title)], fields);
};

const signatureModifiers = /^(?:(?:readonly|optional|static|abstract)\s+)*/;

const tokenizedType = (type: string): PhrasingContent[] =>
  breakableType([{ type: "text", value: type }]).map((node) =>
    node.type === "text" ? { type: "inlineCode", value: node.value } : node,
  );

const isSourceLink = (node: RootContent) =>
  node.type === "mdxJsxFlowElement" && node.name === "SourceLink";

const plainPropertyField = (
  heading: string,
  body: RootContent[],
): MdxJsxFlowElement | undefined => {
  const [signature, ...rest] = body.filter((node) => !isSourceLink(node));
  if (signature?.type !== "code") return undefined;
  const labels = rest.filter((node) => node.type === "heading");
  if (labels.some((label) => mdastToString(label) !== "Default")) return undefined;
  if (rest.some((node) => node.type === "table")) return undefined;
  const declaration = signature.value.replace(signatureModifiers, "").replace(/;\s*$/, "");
  const separator = declaration.indexOf(": ");
  const defaultIndex = rest.findIndex((node) => node.type === "heading");
  const description = defaultIndex === -1 ? rest : rest.slice(0, defaultIndex);
  const defaultValue = defaultIndex === -1 ? undefined : rest[defaultIndex + 1];
  const optional = heading.endsWith("?");
  const name = optional ? heading.slice(0, -1) : heading;
  return flowElement(
    "ApiField",
    [
      attribute("name", name),
      attribute("id", new GithubSlugger().slug(heading)),
      ...(optional ? [attribute("optional", "true")] : []),
    ],
    [
      ...(separator === -1
        ? []
        : [flowElement("ApiFieldType", [], tokenizedType(declaration.slice(separator + 2)))]),
      ...(defaultValue === undefined
        ? []
        : [
            flowElement(
              "ApiFieldDefault",
              [],
              defaultValue.type === "code"
                ? tokenizedType(defaultValue.value)
                : defaultValue.type === "paragraph"
                  ? defaultValue.children
                  : [],
            ),
          ]),
      ...(description.length > 0 ? [flowElement("ApiFieldDescription", [], description)] : []),
    ],
  );
};

const groupPlainProperties = (children: RootContent[]): RootContent[] => {
  const result: RootContent[] = [];
  let pendingFields: MdxJsxFlowElement[] = [];
  const flushFields = () => {
    if (pendingFields.length > 0) result.push(flowElement("ApiFields", [], pendingFields));
    pendingFields = [];
  };
  let inProperties = false;
  let index = 0;
  while (index < children.length) {
    const node = children[index];
    if (node.type === "heading" && node.depth <= 2) {
      flushFields();
      inProperties = mdastToString(node) === "Properties";
    }
    if (!inProperties || node.type !== "heading" || node.depth !== 3) {
      if (node.type !== "thematicBreak") result.push(node);
      index++;
      continue;
    }
    const end = sectionEnd(children, index, 3);
    const field = plainPropertyField(
      mdastToString(node),
      children.slice(index + 1, end).filter((child) => child.type !== "thematicBreak"),
    );
    if (field === undefined) {
      flushFields();
      result.push(...children.slice(index, end));
    } else {
      pendingFields.push(field);
    }
    index = end;
  }
  flushFields();
  return result;
};

const sectionBody = (children: RootContent[], heading: string, depth: number) => {
  const start = children.findIndex(
    (node) => node.type === "heading" && node.depth === depth && mdastToString(node) === heading,
  );
  return start === -1
    ? undefined
    : {
        start,
        end: sectionEnd(children, start, depth),
        body: children.slice(start + 1, sectionEnd(children, start, depth)),
      };
};

const restructureClassPage = (children: RootContent[]): RootContent[] => {
  const title = /^Class: (.+)$/.exec(
    headingText(children.find((node) => node.type === "heading" && node.depth === 1)) ?? "",
  )?.[1];
  if (title === undefined) return children;
  const extendsSection = sectionBody(children, "Extends", 2);
  const bases =
    extendsSection?.body.flatMap((node) =>
      node.type === "list" ? node.children.map((item) => mdastToString(item).trim()) : [],
    ) ?? [];
  const withoutExtends = extendsSection
    ? [...children.slice(0, extendsSection.start), ...children.slice(extendsSection.end)]
    : children;
  const constructors = sectionBody(withoutExtends, "Constructors", 2);
  const result =
    constructors &&
    constructors.body.filter((node) => node.type === "heading" && node.depth === 3).length === 1
      ? [
          ...withoutExtends.slice(0, constructors.start),
          {
            type: "heading" as const,
            depth: 2 as const,
            children: [{ type: "text" as const, value: "Constructor" }],
          },
          ...constructors.body.filter((node, index, body) => {
            if (node.type === "heading" && node.depth === 3) return false;
            const returns = body.findIndex((candidate) => headingText(candidate) === "Returns");
            return returns === -1 || index < returns || index >= sectionEnd(body, returns, 4);
          }),
          ...withoutExtends.slice(constructors.end),
        ]
      : withoutExtends;
  const titleIndex = result.findIndex((node) => node.type === "heading" && node.depth === 1);
  return [
    ...result.slice(0, titleIndex + 1),
    {
      type: "code",
      lang: "ts",
      meta: "signature",
      value: `class ${title}${bases.length > 0 ? ` extends ${bases.join(", ")}` : ""}`,
    },
    ...result.slice(titleIndex + 1),
  ];
};

const externalReferenceSections = new Set(["Overrides", "Inherited from"]);

const mergedThrows = (children: RootContent[], start: number, depth: number) => {
  const entries: RootContent[][] = [];
  let next = start;
  while (headingText(children[next]) === "Throws") {
    const end = sectionEnd(children, next, depth);
    entries.push(children.slice(next + 1, end).filter((node) => node.type !== "thematicBreak"));
    next = end;
  }
  const body: RootContent[] =
    entries.length === 1
      ? entries[0]
      : [
          {
            type: "list",
            ordered: false,
            spread: false,
            children: entries.map((entry) => ({
              type: "listItem",
              spread: false,
              children: entry as ListItem["children"],
            })),
          },
        ];
  return { body, end: next };
};

const sectionWrappedAtHeadingLevel = new Set(["Returns", "Throws"]);

const restructureApiSections = (children: RootContent[]): RootContent[] => {
  const result: RootContent[] = [];
  let index = 0;
  while (index < children.length) {
    const node = children[index];
    const previous = result.at(-1);
    index++;
    if (node.type === "thematicBreak") continue;
    if (node.type === "table") {
      result.push(tableFields(node, undefined));
      continue;
    }
    if (
      node.type === "code" &&
      (previous === undefined ||
        (previous.type === "heading" && !/^Examples?$/.test(mdastToString(previous))))
    ) {
      result.push({ ...node, meta: "signature" });
      continue;
    }
    if (node.type !== "heading") {
      result.push(node);
      continue;
    }
    const text = mdastToString(node);
    const section =
      text === "Throws"
        ? mergedThrows(children, index - 1, node.depth)
        : {
            body: children.slice(index, sectionEnd(children, index - 1, node.depth)),
            end: sectionEnd(children, index - 1, node.depth),
          };
    const body = section.body.filter((child) => child.type !== "thematicBreak");
    if (externalReferenceSections.has(text) && body.every((child) => child.type === "code")) {
      index = section.end;
      continue;
    }
    const isType = text === "Returns";
    const variant = isType ? [attribute("variant", "type")] : [];
    if (isType) {
      for (const child of body) {
        if (child.type === "paragraph") child.children = breakableType(child.children);
      }
    }
    if (node.depth < 4) {
      result.push(node);
      if (sectionWrappedAtHeadingLevel.has(text)) {
        result.push(flowElement("ApiSection", variant, restructureApiSections(body)));
        index = section.end;
      }
      continue;
    }
    const [onlyChild] = body;
    result.push(
      body.length === 1 && onlyChild?.type === "table"
        ? tableFields(onlyChild, text)
        : flowElement(
            "ApiSection",
            [attribute("title", text), ...variant],
            restructureApiSections(body),
          ),
    );
    index = section.end;
  }
  return result;
};

const isExperimentalMarker = (node: RootContent) =>
  node.type === "paragraph" &&
  node.children.length === 1 &&
  node.children[0]?.type === "strong" &&
  mdastToString(node) === "Experimental";

const withoutPageExperimentalMarker = (children: RootContent[]): RootContent[] => {
  const firstSection = children.findIndex((node) => node.type === "heading" && node.depth === 2);
  return children.filter(
    (node, index) => !isExperimentalMarker(node) || (firstSection !== -1 && index > firstSection),
  );
};

const remarkApiPages =
  (options: { contentDirectory: string }) => (tree: MdastRoot, file: VFile) => {
    if (!isApiPage(options.contentDirectory, file)) return;
    tree.children = restructureClassPage(withoutPageExperimentalMarker(tree.children));
    visit(tree, "paragraph", (node, index, parent) => {
      const [first, link] = node.children;
      if (parent === undefined || index === undefined) return;
      if (
        first?.type !== "text" ||
        !first.value.startsWith("Defined in:") ||
        link?.type !== "link"
      ) {
        return;
      }
      parent.children[index] = {
        type: "mdxJsxFlowElement",
        name: "SourceLink",
        attributes: [attribute("href", link.url), attribute("label", mdastToString(link))],
        children: [],
      };
    });
    tree.children = restructureApiSections(groupPlainProperties(tree.children));
  };

const exportConst = (name: string, value: unknown): MdxjsEsmHast => {
  const estree: Program = {
    type: "Program",
    sourceType: "module",
    body: [
      {
        type: "ExportNamedDeclaration",
        specifiers: [],
        source: null,
        attributes: [],
        declaration: {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: { type: "Identifier", name },
              init: valueToEstree(value),
            },
          ],
        },
      },
    ],
  };
  return { type: "mdxjsEsm", value: "", data: { estree } };
};

const rehypeHeadings = () => (tree: HastRoot) => {
  const slugger = new GithubSlugger();
  const headings: { depth: number; text: string; id: string }[] = [];
  visit(tree, "element", (node) => {
    const depth = Number(/^h([2-4])$/.exec(node.tagName)?.[1]);
    if (!depth) return;
    const text = hastToString(node);
    const id = slugger.slug(text);
    node.properties.id = id;
    if (depth <= 3) headings.push({ depth, text, id });
    node.children.push({
      type: "element",
      tagName: "a",
      properties: {
        href: `#${id}`,
        className: ["heading-anchor"],
        ariaHidden: "true",
        tabIndex: -1,
      },
      children: [{ type: "text", value: "#" }],
    });
  });
  tree.children.unshift(exportConst("headings", headings));
};

const codeLang = (code: Element): string => {
  const className = code.properties.className;
  const languageClass = Array.isArray(className)
    ? className.map(String).find((name) => name.startsWith("language-"))
    : undefined;
  return languageClass?.slice("language-".length) ?? "text";
};

const rehypeCodeBlocks = () => async (tree: HastRoot) => {
  const blocks: { pre: Element; code: Element; replace: (node: MdxJsxFlowElementHast) => void }[] =
    [];
  visit(tree, "element", (node, index, parent) => {
    const [code] = node.children;
    if (node.tagName !== "pre" || code?.type !== "element" || code.tagName !== "code") return;
    if (parent === undefined || index === undefined) return;
    blocks.push({
      pre: node,
      code,
      replace: (replacement) => {
        parent.children[index] = replacement as ElementContent;
      },
    });
  });
  await Promise.all(
    blocks.map(async ({ code, replace }) => {
      const lang = codeLang(code);
      const source = hastToString(code).replace(/\n$/, "");
      const title = /title="([^"]+)"/.exec(code.data?.meta ?? "")?.[1];
      replace({
        type: "mdxJsxFlowElement",
        name: "Code",
        attributes: [
          attribute("lang", lang),
          attribute("code", source),
          attribute("html", await highlight(source, lang)),
          ...(title ? [attribute("title", title)] : []),
          ...(/(^|\s)signature(\s|$)/.test(code.data?.meta ?? "")
            ? [attribute("signature", "true")]
            : []),
        ],
        children: [],
      });
    }),
  );
};

const recmaIntrinsicElements = () => (tree: Program) => {
  visitEstree(tree, (node: Node) => {
    if (node.type === "VariableDeclarator" && node.init?.type === "ObjectExpression") {
      if (node.id.type !== "Identifier" || node.id.name !== "_components") return;
      node.init.properties = node.init.properties.filter(
        (property) => property.type !== "Property" || property.value.type !== "Literal",
      );
      return;
    }
    if (node.type !== "JSXOpeningElement" && node.type !== "JSXClosingElement") return;
    const name = node.name;
    if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return;
    if (name.object.name !== "_components" || !/^[a-z]/.test(name.property.name)) return;
    node.name = { type: "JSXIdentifier", name: name.property.name };
  });
};

export const mdxOptions = (options: {
  contentDirectory: string;
  base: string;
}): CompileOptions => ({
  jsx: true,
  jsxImportSource: "solid-js",
  elementAttributeNameCase: "html",
  stylePropertyNameCase: "css",
  remarkPlugins: [
    remarkFrontmatter,
    remarkGfm,
    remarkAsides,
    [remarkApiPages, options],
    [remarkTables, options],
    remarkImageImports,
    remarkStripTitle,
    [remarkRelativeLinks, options],
  ],
  rehypePlugins: [rehypeCodeBlocks, rehypeHeadings],
  recmaPlugins: [recmaIntrinsicElements],
});
