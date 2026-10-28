import { type Highlighter, createCssVariablesTheme, createHighlighter } from "shiki";

const theme = createCssVariablesTheme({
  name: "queuert",
  variablePrefix: "--shiki-",
  fontStyle: true,
});

const languages = ["ts", "tsx", "js", "json", "bash", "sql", "yaml", "diff", "lua", "text"];

let highlighter: Promise<Highlighter> | undefined;

export const highlight = async (code: string, lang: string): Promise<string> => {
  highlighter ??= createHighlighter({ themes: [theme], langs: languages });
  const instance = await highlighter;
  const resolvedLang = instance.getLoadedLanguages().includes(lang) ? lang : "text";
  return instance.codeToHtml(code, { lang: resolvedLang, theme: "queuert" });
};
