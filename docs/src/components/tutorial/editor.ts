import { type Completion, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  HighlightStyle,
  bracketMatching,
  codeFolding,
  foldEffect,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import type { ExerciseLanguageClient } from "./client.ts";
import { importFoldRanges } from "./fold.ts";
import type { ExerciseFiles } from "./runtime.ts";

const completionTypes: Record<string, string> = {
  function: "function",
  "local function": "function",
  method: "method",
  property: "property",
  getter: "property",
  setter: "property",
  var: "variable",
  let: "variable",
  const: "constant",
  "local var": "variable",
  parameter: "variable",
  keyword: "keyword",
  class: "class",
  interface: "interface",
  type: "type",
  alias: "type",
  enum: "enum",
  module: "namespace",
  string: "text",
};

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: "var(--color-syntax-key)" },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--color-syntax-string)",
  },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--color-syntax-number)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--color-accent-fg)",
  },
  { tag: [tags.typeName, tags.className], color: "var(--color-syntax-number)" },
  { tag: [tags.punctuation, tags.operator, tags.bracket], color: "var(--color-fg-muted)" },
  { tag: tags.comment, color: "var(--color-fg-subtle)", fontStyle: "italic" },
]);

const theme = EditorView.theme({
  "&": { color: "var(--color-fg)", backgroundColor: "transparent", fontSize: "0.8125rem" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "1rem 0", caretColor: "var(--color-fg)" },
  ".cm-cursor": { borderLeftColor: "var(--color-fg)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--color-fg-subtle)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 0.75rem 0 1rem" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-surface-2)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "color-mix(in srgb, var(--color-accent) 25%, transparent)" },
  ".cm-matchingBracket": { outline: "1px solid var(--color-border-strong)" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "2px",
    color: "var(--color-fg)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-surface-2)",
    color: "var(--color-fg)",
  },
  ".cm-quickinfo": { maxWidth: "36rem", padding: "0.375rem 0.625rem", fontSize: "0.75rem" },
  ".cm-quickinfo pre": { margin: "0", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" },
  ".cm-quickinfo p": { margin: "0.375rem 0 0", color: "var(--color-fg-muted)" },
  ".cm-diagnostic": { fontSize: "0.75rem", whiteSpace: "pre-wrap" },
});

export type ExerciseEditor = {
  /** Shows `file`, keeping each file's undo history across switches. */
  show: (file: string) => void;
  /** Replaces every file, as Solve and Reset do. */
  load: (files: ExerciseFiles) => void;
  destroy: () => void;
};

/**
 * A CodeMirror editor over a lesson's files, multi-line imports folded; Mod-Enter runs them. `language` type-checks every file
 * as the reader types, shows types on hover and completes from TypeScript. The `readOnly` files can be read but not edited.
 */
export const createExerciseEditor = (options: {
  parent: HTMLElement;
  files: ExerciseFiles;
  file: string;
  readOnly: string[];
  language: ExerciseLanguageClient;
  onChange: (file: string, source: string) => void;
  onRun: () => void;
}): ExerciseEditor => {
  let current = options.file;
  const states = new Map<string, EditorState>();
  const snapshot = (file: string, state: EditorState): ExerciseFiles => ({
    ...Object.fromEntries([...states].map(([name, other]) => [name, other.doc.toString()])),
    [file]: state.doc.toString(),
  });
  const languageFeatures = (file: string) => [
    linter(
      async (view) => {
        const length = view.state.doc.length;
        const diagnostics = await options.language.diagnostics(snapshot(file, view.state));
        return diagnostics
          .filter((diagnostic) => diagnostic.file === file)
          .map((diagnostic) => ({
            from: Math.min(diagnostic.from, length),
            to: Math.min(Math.max(diagnostic.to, diagnostic.from), length),
            severity: diagnostic.severity,
            message: diagnostic.message,
          }));
      },
      { delay: 400 },
    ),
    hoverTooltip(async (view, position) => {
      const info = await options.language.quickInfo(snapshot(file, view.state), file, position);
      if (info === undefined) return null;
      return {
        pos: info.from,
        end: info.to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-quickinfo";
          const signature = document.createElement("pre");
          signature.textContent = info.signature;
          dom.append(signature);
          if (info.documentation !== "") {
            const documentation = document.createElement("p");
            documentation.textContent = info.documentation;
            dom.append(documentation);
          }
          return { dom };
        },
      };
    }),
    autocompletion({
      override: [
        async (context) => {
          const word = context.matchBefore(/[\w$]*/);
          const previous = context.state.sliceDoc(context.pos - 1, context.pos);
          if (
            !context.explicit &&
            (word === null || word.from === word.to) &&
            !/[."']/.test(previous)
          ) {
            return null;
          }
          const result = await options.language.completions(
            snapshot(file, context.state),
            file,
            context.pos,
          );
          if (result === undefined || context.aborted) return null;
          return {
            from: result.from,
            options: result.options.map((option): Completion => ({
              label: option.label,
              type: completionTypes[option.kind] ?? "text",
              boost: -Math.min(Number.parseInt(option.sortText, 10) || 0, 99),
            })),
            validFor: /^[\w$]*$/,
          };
        },
      ],
    }),
  ];
  const stateFor = (file: string, source: string) => {
    const state = EditorState.create({
      doc: source,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        EditorState.tabSize.of(2),
        javascript({ typescript: true }),
        syntaxHighlighting(highlightStyle),
        theme,
        EditorState.readOnly.of(options.readOnly.includes(file)),
        languageFeatures(file),
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              options.onRun();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(file, update.state.doc.toString());
        }),
        codeFolding({ placeholderText: "…" }),
        EditorView.lineWrapping,
      ],
    });
    return state.update({
      effects: importFoldRanges(source).map((range) => foldEffect.of(range)),
    }).state;
  };
  const fill = (files: ExerciseFiles) => {
    states.clear();
    for (const [file, source] of Object.entries(files)) states.set(file, stateFor(file, source));
  };
  fill(options.files);
  const view = new EditorView({ parent: options.parent, state: states.get(current) });
  void document.fonts?.ready.then(() => {
    view.requestMeasure();
  });

  return {
    show: (file) => {
      const next = states.get(file);
      if (next === undefined || file === current) return;
      states.set(current, view.state);
      current = file;
      view.setState(next);
    },
    load: (files) => {
      fill(files);
      view.setState(states.get(current) ?? states.values().next().value!);
    },
    destroy: () => {
      view.destroy();
    },
  };
};
