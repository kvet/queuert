/** The braces of each multi-line named import, which the editor shows folded as `{…}`. */
export const importFoldRanges = (source: string): { from: number; to: number }[] =>
  [...source.matchAll(/^import(?: type)? \{([^}]*)\} from /gm)]
    .filter((match) => match[1].includes("\n"))
    .map((match) => {
      const from = match.index + match[0].indexOf("{") + 1;
      return { from, to: from + match[1].length };
    });

/** `source` with its import folds collapsed to `…`, as the editor first shows it. */
export const foldImports = (source: string): string =>
  importFoldRanges(source)
    .reverse()
    .reduce((folded, range) => `${folded.slice(0, range.from)}…${folded.slice(range.to)}`, source);
