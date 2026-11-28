import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const withPlaceholders = (plan: string): string =>
  plan
    .trimEnd()
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replaceAll(
      /'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?'/g,
      "'<timestamp>'",
    );

const codeSpan = (text: string): string =>
  text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;

export const writePlansFile = ({
  path,
  title,
  description,
  sections,
}: {
  path: string;
  title: string;
  description: string;
  sections: { heading: string; plans: { label: string; plan: string }[] }[];
}): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      `# ${title}`,
      description,
      ...sections.map(({ heading, plans }) =>
        [
          `## ${heading}`,
          ...(plans.length === 0
            ? ["No query plans."]
            : plans.map(({ label, plan }, index) =>
                [`${index + 1}. ${codeSpan(label)}`, "", "```", withPlaceholders(plan), "```"].join(
                  "\n",
                ),
              )),
        ].join("\n\n"),
      ),
    ].join("\n\n") + "\n",
  );
  console.log(`  Plans written to ${path}`);
};
