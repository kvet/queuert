import type { JSX } from "@solidjs/web";
import { Show, createContext, createSignal, onSettled, useContext } from "solid-js";

import { Exercise } from "./Exercise.tsx";

export type TaskExercise = Parameters<typeof Exercise>[0];

type TaskState = {
  exercise: () => TaskExercise | undefined;
  step: boolean;
  line: () => string;
  setLine: (html: string) => void;
  desktop: () => boolean | undefined;
};

const TaskContext = createContext<TaskState | null>(null);

const desktopQuery = "(min-width: 64rem)";

/**
 * Provides a step page's exercise to its `<TryIt>` line and to `TaskPanel`.
 * `desktop` is where the panel sits beside the prose; below that width the exercise opens right
 * under the task line instead. Until the width is known after hydration, neither shows the exercise,
 * so only one of them ever mounts it.
 */
export const TaskProvider = (props: {
  exercise: () => TaskExercise | undefined;
  step: boolean;
  children: JSX.Element;
}) => {
  const [line, setLine] = createSignal("");
  const [desktop, setDesktop] = createSignal<boolean | undefined>(undefined);

  onSettled(() => {
    try {
      const query = matchMedia(desktopQuery);
      const update = () => setDesktop(query.matches);
      update();
      query.addEventListener("change", update);
      return () => {
        query.removeEventListener("change", update);
      };
    } catch {
      setDesktop(true);
      return undefined;
    }
  });

  return (
    <TaskContext value={{ exercise: props.exercise, step: props.step, line, setLine, desktop }}>
      {props.children}
    </TaskContext>
  );
};

/**
 * The task line of a `layout: "step"` page. Pages write `<TryIt lesson="first-chain">what to do</TryIt>`;
 * the build exports the lesson's files from the page module. The line is followed by the exercise on
 * narrow screens and points at `TaskPanel` beside the prose on wide ones.
 */
export const TryIt = (props: { lesson: string; children?: JSX.Element }) => {
  const task = useContext(TaskContext);
  const line: { element?: HTMLSpanElement } = {};

  onSettled(() => {
    if (task?.step && line.element !== undefined) task.setLine(line.element.innerHTML);
  });

  return (
    <div data-try-it={props.lesson} class="my-4">
      <div class="flex items-start gap-3 rounded-xs border border-accent-fg bg-surface px-3 py-2 text-sm text-fg">
        <span>
          <span class="font-semibold">Your task:</span>{" "}
          <span ref={(element) => (line.element = element)}>{props.children}</span>
        </span>
        <span aria-hidden="true" class="ml-auto shrink-0 text-accent-fg">
          <span class="hidden lg:inline">→</span>
          <span class="lg:hidden">↓</span>
        </span>
      </div>
      <Show when={task?.step === true && task.desktop() === false ? task.exercise() : undefined}>
        {(exercise) => (
          <div class="mt-3">
            <Exercise {...exercise()} />
          </div>
        )}
      </Show>
    </div>
  );
};

/**
 * The side panel of a step page: its exercise beside the prose, sticky and sized to the viewport.
 * The panel keeps its place in the layout from the prerendered page on, and the exercise fills it
 * once the page knows it is wide enough.
 */
export const TaskPanel = () => {
  const task = useContext(TaskContext);

  return (
    <Show when={task?.exercise()}>
      {(exercise) => (
        <aside
          aria-label="Task"
          class="hidden min-w-0 lg:sticky lg:top-20 lg:block lg:h-[calc(100dvh-11.5rem)] lg:w-[46%] lg:shrink-0 lg:self-start xl:w-[min(46rem,50%)]"
          data-try-it-panel
        >
          <Show when={task?.desktop() === true}>
            <Exercise {...exercise()} task={task?.line()} panel />
          </Show>
        </aside>
      )}
    </Show>
  );
};
