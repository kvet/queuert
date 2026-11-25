import { Box, CheckIcon, ChoiceChips, WarningIcon } from "@queuert/ui/components";
import { For, Match, Show, Switch, createMemo, createSignal, onSettled } from "solid-js";

import { learnSteps } from "../../data/learn.ts";
import { ChainView } from "./ChainView.tsx";
import type { ExerciseEditor } from "./editor.ts";
import { markStepDone } from "./progress.ts";
import { type ChainEvent, groupFrames } from "./recorder.ts";
import { createRunController } from "./run-controller.ts";
import {
  type ExerciseFiles,
  type ExerciseLog,
  type ExerciseResult,
  exerciseEntry,
} from "./runtime.ts";

const solvedMessage = (lesson: string) => {
  const index = learnSteps.findIndex((step) => step.id === lesson);
  if (index === -1 || index === learnSteps.length - 1) return "Solved.";
  return "Solved. On to the next lesson.";
};

const draftKey = (lesson: string) => `queuert-docs:draft:${lesson}`;

const sameFiles = (a: ExerciseFiles, b: ExerciseFiles) =>
  Object.keys(a).join("\n") === Object.keys(b).join("\n");

const readDraft = (lesson: string, start: ExerciseFiles): ExerciseFiles | undefined => {
  try {
    const stored = localStorage.getItem(draftKey(lesson));
    if (stored === null) return undefined;
    const draft = JSON.parse(stored) as ExerciseFiles;
    return sameFiles(draft, start) ? draft : undefined;
  } catch {
    return undefined;
  }
};

const writeDraft = (lesson: string, files: ExerciseFiles | undefined) => {
  try {
    if (files === undefined) localStorage.removeItem(draftKey(lesson));
    else localStorage.setItem(draftKey(lesson), JSON.stringify(files));
  } catch {}
};

const frameMs = 450;

const prefersReducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const buttonClass =
  "inline-flex items-center gap-1 rounded-xs px-1.5 text-xs text-fg-muted hover:text-fg disabled:opacity-50";

type RunState = { status: "idle" } | { status: "running" } | ExerciseResult;

/**
 * A tutorial lesson's code, editable and runnable in the browser, with the lesson's `start` and
 * `solution` files, its `check` and the highlighted start files that the build exports from a step
 * page with a `<TryIt>`. The prerendered page shows the highlighted code, and the editor takes over
 * once the page hydrates, restoring the reader's draft for the lesson.
 */
export const Exercise = (props: {
  lesson: string;
  start: string;
  solution: string;
  check: string;
  html: string;
  task?: string;
  panel?: boolean;
}) => {
  const start = JSON.parse(props.start) as ExerciseFiles;
  const solution = JSON.parse(props.solution) as ExerciseFiles;
  const check = props.check;
  const html = JSON.parse(props.html) as Record<string, string>;
  const fileNames = Object.keys(start);

  let files: ExerciseFiles = { ...start };
  let editor: ExerciseEditor | undefined;
  let editorHost: HTMLDivElement | undefined = undefined;
  const root: { element?: HTMLDivElement } = {};

  const [file, setFile] = createSignal(exerciseEntry);
  const [editorReady, setEditorReady] = createSignal(false);
  const [logs, setLogs] = createSignal<(ExerciseLog & { afterEvents: number })[]>([]);
  const [runState, setRunState] = createSignal<RunState>({ status: "idle" });

  const [chainEvents, setChainEvents] = createSignal<ChainEvent[]>([]);
  const [shown, setShown] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  let recorded: ChainEvent[] = [];
  let collectedLogs: (ExerciseLog & { afterEvents: number })[] = [];
  let shownCount = 0;
  let player: ReturnType<typeof setInterval> | undefined;

  const frames = createMemo(() => groupFrames(chainEvents()));

  const stopPlayer = () => {
    clearInterval(player);
    player = undefined;
    setPlaying(false);
  };
  const advance = () => {
    const frameCount = groupFrames(recorded).length;
    if (prefersReducedMotion()) shownCount = frameCount;
    else if (shownCount < frameCount) shownCount++;
    setShown(shownCount);
    if (shownCount >= frameCount && controller.isFinished()) stopPlayer();
  };
  const play = (from: number) => {
    shownCount = from;
    setShown(from);
    setPlaying(true);
    clearInterval(player);
    player = setInterval(advance, frameMs);
    advance();
  };

  const controller = createRunController({
    launch: async (handlers) => {
      const { runExercise } = await import("./client.ts");
      return runExercise({ files, check, ...handlers });
    },
    onStart: () => {
      stopPlayer();
      recorded = [];
      collectedLogs = [];
      setChainEvents([]);
      setLogs([]);
      setRunState({ status: "running" });
      requestAnimationFrame(() => {
        root.element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      play(0);
    },
    onLog: (log) => {
      collectedLogs = [...collectedLogs, { ...log, afterEvents: recorded.length }];
      setLogs(collectedLogs);
    },
    onChainEvent: (event) => {
      recorded = [...recorded, event];
      setChainEvents(recorded);
      if (shownCount === 0) advance();
    },
    onFinish: (result) => {
      setRunState(result);
      if (result.status === "passed") markStepDone(props.lesson);
      if (shownCount >= groupFrames(recorded).length) stopPlayer();
    },
  });

  const runFiles = async () => controller.run();

  const visibleLogs = () => {
    if (!playing()) return logs();
    const shownEvents = frames().slice(0, shown()).flat().length;
    return logs().filter((log) => log.afterEvents <= shownEvents);
  };

  const clearOutput = () => {
    controller.cancel();
    stopPlayer();
    recorded = [];
    collectedLogs = [];
    setChainEvents([]);
    setLogs([]);
    setRunState({ status: "idle" });
  };

  const load = (next: ExerciseFiles) => {
    files = { ...next };
    editor?.load(files);
  };

  onSettled(() => {
    let disposed = false;
    const draft = readDraft(props.lesson, start);
    if (draft !== undefined) files = draft;
    void Promise.all([import("./editor.ts"), import("./client.ts")]).then(
      ([{ createExerciseEditor }, { exerciseLanguage }]) => {
        if (disposed || editorHost === undefined) return;
        editor = createExerciseEditor({
          parent: editorHost,
          files,
          file: file(),
          language: exerciseLanguage,
          onChange: (changed, source) => {
            files = { ...files, [changed]: source };
            writeDraft(props.lesson, files);
          },
          onRun: () => void runFiles(),
        });
        setEditorReady(true);
      },
    );
    return () => {
      disposed = true;
      stopPlayer();
      controller.cancel();
      editor?.destroy();
    };
  });

  return (
    <div
      class={[
        "not-prose flex flex-col gap-5",
        props.panel ? "h-full min-h-0 pt-2" : "my-6 max-h-[calc(100dvh-8rem)] min-h-64",
      ]}
      data-exercise={props.lesson}
      ref={(element) => (root.element = element)}
    >
      <Box
        title="Exercise"
        class="flex min-h-0 flex-1 flex-col"
        bodyClass="flex min-h-0 flex-1 flex-col overflow-y-auto"
        actions={
          <>
            <button
              type="button"
              class={buttonClass}
              disabled={!editorReady()}
              title="Start over from the lesson's code"
              onClick={() => {
                load(start);
                writeDraft(props.lesson, undefined);
                clearOutput();
              }}
            >
              Reset
            </button>
            <button
              type="button"
              class={buttonClass}
              disabled={!editorReady()}
              title="Load the solution and run it"
              onClick={() => {
                load(solution);
                void runFiles();
              }}
            >
              Solve
            </button>
            <button
              type="button"
              class={`${buttonClass} font-medium text-fg`}
              disabled={!editorReady()}
              title="Run (Ctrl+Enter / ⌘+Enter)"
              onClick={() => void runFiles()}
            >
              Run ▶
            </button>
          </>
        }
      >
        <Show when={props.task}>
          {(task) => (
            <p
              class="m-0 border-b border-border px-4 py-2.5 font-sans text-sm leading-6 text-fg [&_code]:rounded-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs"
              data-exercise-task
            >
              <span class="font-semibold">Your task:</span> <span innerHTML={task()} />
            </p>
          )}
        </Show>
        <Show when={fileNames.length > 1}>
          <div class="px-4 pt-3">
            <ChoiceChips
              label="File"
              options={fileNames.map((name) => ({ value: name, label: name }))}
              value={file()}
              onChange={(name) => {
                setFile(name);
                editor?.show(name);
              }}
            />
          </div>
        </Show>
        <Show when={!editorReady()}>
          <div
            class="code-html [&_pre]:[overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap"
            innerHTML={html[file()] ?? ""}
          />
        </Show>
        <div ref={editorHost} class="exercise-editor" />
      </Box>
      <Box
        title="Output"
        class={`flex shrink-0 flex-col ${
          runState().status === "idle" ? "" : props.panel ? "basis-[30%]" : "h-56"
        }`}
        bodyClass={`min-h-0 flex-1 overflow-y-auto px-4 font-mono text-xs leading-relaxed ${
          runState().status === "idle" ? "py-2" : "py-3"
        }`}
        actions={
          <Switch>
            <Match when={runState().status === "running" || playing()}>
              <span class="text-xs text-fg-muted">Running…</span>
            </Match>
            <Match when={chainEvents().length > 0}>
              <button
                type="button"
                class={buttonClass}
                title="Play the run's chain again"
                onClick={() => {
                  play(0);
                }}
              >
                Replay
              </button>
            </Match>
          </Switch>
        }
      >
        <Show
          when={runState().status !== "idle"}
          fallback={<p class="text-fg-subtle">Press Run to see the output.</p>}
        >
          <Show
            when={
              chainEvents().length > 0 ||
              (!playing() && (runState().status === "passed" || runState().status === "failed"))
            }
          >
            <div class="mb-3 border-b border-border pb-3">
              <ChainView
                events={chainEvents()}
                shown={shown()}
                finished={
                  !playing() && (runState().status === "passed" || runState().status === "failed")
                }
              />
            </div>
          </Show>
          <For each={visibleLogs()}>
            {(log) => (
              <div
                class={[
                  "whitespace-pre-wrap break-words",
                  log.level === "error" || log.level === "warn" ? "text-error-fg" : "text-fg",
                ]}
              >
                {log.text}
              </div>
            )}
          </For>
          <Show when={!playing()}>
            <Switch>
              <Match when={runState().status === "passed"}>
                <p class="mt-2 inline-flex items-center gap-1.5 font-sans text-sm text-fg">
                  <CheckIcon size={14} /> {solvedMessage(props.lesson)}
                </p>
              </Match>
              <Match when={runState().status === "failed" && (runState() as { message: string })}>
                {(failed) => (
                  <p class="mt-2 inline-flex items-start gap-1.5 font-sans text-sm text-fg-muted">
                    <WarningIcon size={14} class="mt-0.5 shrink-0" />
                    <span>Not yet: {failed().message}</span>
                  </p>
                )}
              </Match>
              <Match when={runState().status === "error" && (runState() as { message: string })}>
                {(error) => (
                  <pre class="mt-2 whitespace-pre-wrap text-error-fg">{error().message}</pre>
                )}
              </Match>
            </Switch>
          </Show>
        </Show>
      </Box>
    </div>
  );
};
