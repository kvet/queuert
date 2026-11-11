import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

export type DeploymentVersion = "older" | "newer";

export type DeploymentPause = "none" | "before-migrating" | "inside-migration";

export type DeploymentOutcome<TResult> = TResult | { error: string };

export const runDeploymentProcess = async ({
  migrate,
  close,
}: {
  migrate: (deployment: {
    version: DeploymentVersion;
    pause: (point: DeploymentPause) => Promise<void>;
  }) => Promise<unknown>;
  close: () => Promise<void> | void;
}): Promise<never> => {
  const [version, pauseAt] = process.argv.slice(3) as [DeploymentVersion, DeploymentPause];
  const waitForGo = async (line: string): Promise<void> => {
    process.stdout.write(`${line}\n`);
    await once(process.stdin, "data");
  };
  let paused = false;
  const pause = async (point: DeploymentPause): Promise<void> => {
    if (paused || point !== pauseAt) return;
    paused = true;
    await waitForGo("paused");
  };

  await waitForGo("ready");
  let outcome: unknown;
  try {
    outcome = await migrate({ version, pause });
  } catch (error) {
    outcome = { error: (error as Error).message };
  }
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  await close();
  process.exit(0);
};

export type DeploymentProcess<TResult> = {
  go: () => void;
  waitFor: (line: string) => Promise<void>;
  finished: () => boolean;
  result: () => Promise<DeploymentOutcome<TResult>>;
  freeze: () => void;
  thaw: () => void;
  kill: () => Promise<void>;
};

export const createDeploymentSpawner =
  <TResult>(script: string, cwd: string) =>
  (target: string, version: DeploymentVersion, pause: DeploymentPause = "none") => {
    const child: ChildProcess = spawn(process.execPath, [script, target, version, pause], {
      cwd,
      stdio: ["pipe", "pipe", "inherit"],
    });
    const lines: string[] = [];
    const waiters: { predicate: (line: string) => boolean; resolve: (line: string) => void }[] = [];
    createInterface({ input: child.stdout! }).on("line", (line) => {
      lines.push(line);
      for (const waiter of waiters.filter((w) => w.predicate(line))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(line);
      }
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    const isResult = (line: string): boolean => line.startsWith("{");
    const nextLine = async (predicate: (line: string) => boolean): Promise<string> => {
      const seen = lines.find(predicate);
      if (seen !== undefined) return seen;
      return Promise.race([
        new Promise<string>((resolve) => waiters.push({ predicate, resolve })),
        exited.then((code) => {
          throw new Error(`deployment process exited with ${code} before printing the line`);
        }),
      ]);
    };

    const deployment: DeploymentProcess<TResult> = {
      go: () => {
        child.stdin!.write("go\n");
      },
      waitFor: async (line) => {
        await nextLine((candidate) => candidate === line);
      },
      finished: () => lines.some(isResult),
      result: async () => JSON.parse(await nextLine(isResult)) as DeploymentOutcome<TResult>,
      freeze: () => {
        child.kill("SIGSTOP");
      },
      thaw: () => {
        child.kill("SIGCONT");
      },
      kill: async () => {
        child.kill("SIGKILL");
        await exited;
      },
    };
    return deployment;
  };

export const startTogether = async <TResult>(
  deployments: DeploymentProcess<TResult>[],
): Promise<DeploymentOutcome<TResult>[]> => {
  await Promise.all(deployments.map(async (deployment) => deployment.waitFor("ready")));
  for (const deployment of deployments) deployment.go();
  return Promise.all(deployments.map(async (deployment) => deployment.result()));
};

export const startPaused = async <TResult>(
  deployment: DeploymentProcess<TResult>,
): Promise<DeploymentProcess<TResult>> => {
  await deployment.waitFor("ready");
  deployment.go();
  await deployment.waitFor("paused");
  return deployment;
};

export { detectResourceLeaks } from "./resource-leak-detection.ts";
