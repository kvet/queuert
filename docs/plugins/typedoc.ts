import { rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Application, Converter, ReflectionKind } from "typedoc";
import type { Plugin } from "vite";

import { type ApiEntryPoint, apiEntryPoints } from "../src/docs/api-entry-points.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../src/content/docs/api", import.meta.url));
const cacheDirectory = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));

export const renderMarkdownReference = async (options: {
  entryPoint: string;
  tsconfig: string;
  name: string;
  out: string;
}) => {
  const app = await Application.bootstrapWithPlugins({
    entryPoints: [options.entryPoint],
    tsconfig: options.tsconfig,
    plugin: ["typedoc-plugin-markdown"],
    readme: "none",
    excludeInternal: true,
    excludeExternals: true,
    displayBasePath: repositoryRoot,
    skipErrorChecking: true,
    gitRevision: "main",
    logLevel: "Warn",
    hideBreadcrumbs: true,
    hidePageHeader: true,
    useCodeBlocks: true,
    expandObjects: true,
    parametersFormat: "table",
    interfacePropertiesFormat: "list",
    classPropertiesFormat: "list",
    typeAliasPropertiesFormat: "list",
    enumMembersFormat: "table",
    propertyMembersFormat: "table",
    typeDeclarationFormat: "table",
    tableColumnSettings: {
      leftAlignHeaders: true,
      hideSources: true,
      hideModifiers: true,
      hideOverrides: true,
      hideInherited: true,
    },
    name: options.name,
    out: options.out,
  } as Parameters<typeof Application.bootstrapWithPlugins>[0]);
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const symbolKeyedMembers = Object.values(context.project.reflections).filter(
      (reflection) =>
        reflection.kindOf(
          ReflectionKind.Property | ReflectionKind.Method | ReflectionKind.Accessor,
        ) && reflection.name.startsWith("["),
    );
    for (const reflection of symbolKeyedMembers) context.project.removeReflection(reflection);
  });
  const project = await app.convert();
  if (!project) throw new Error(`TypeDoc failed to convert ${options.name}`);
  await app.generateOutputs(project);
};

const generateEntryPoint = async (entryPoint: ApiEntryPoint, outputRoot: string) => {
  const packageDirectory = `${repositoryRoot}packages/${entryPoint.dir}`;
  await renderMarkdownReference({
    entryPoint: `${packageDirectory}/${entryPoint.source}`,
    tsconfig: `${packageDirectory}/tsconfig.json`,
    name: entryPoint.label,
    out: `${outputRoot}/${entryPoint.slug}`,
  });
};

let generation: Promise<void> | undefined;

const generateApiReference = async (): Promise<void> => {
  generation ??= (async () => {
    const stagingDirectory = `${cacheDirectory}api-reference-${process.pid}`;
    await rm(stagingDirectory, { recursive: true, force: true });
    for (const entryPoint of apiEntryPoints) await generateEntryPoint(entryPoint, stagingDirectory);
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, outputDirectory);
  })();
  await generation;
};

export const typedoc = (): Plugin => ({
  name: "queuert:typedoc",
  enforce: "pre",
  buildStart: generateApiReference,
});
