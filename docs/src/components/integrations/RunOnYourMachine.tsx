import { exampleCommands, findExample } from "../../data/examples.ts";
import { Code } from "../mdx/Code.tsx";

const cloneCommand = "git clone https://github.com/kvet/queuert.git && cd queuert && pnpm install";

/** The same clone, install and start steps on every adapter page; `needs` names what the example talks to. */
export const RunOnYourMachine = (props: { example: string; needs?: string }) => (
  <>
    <p>
      Clone the repository, install its dependencies and start the <code>{props.example}</code>{" "}
      example{props.needs === undefined ? "" : `, which needs ${props.needs}`}:
    </p>
    <Code lang="bash">
      {[
        cloneCommand,
        ...exampleCommands(findExample(props.example)).map((entry) => entry.command),
      ].join("\n")}
    </Code>
  </>
);
