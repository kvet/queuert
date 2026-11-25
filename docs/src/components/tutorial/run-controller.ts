import type { ExerciseRun } from "./client.ts";
import type { ChainEvent } from "./recorder.ts";
import { type ExerciseLog, type ExerciseResult, errorMessage } from "./runtime.ts";

export const createRunController = (options: {
  launch: (handlers: {
    onLog: (log: ExerciseLog) => void;
    onChainEvent: (event: ChainEvent) => void;
  }) => Promise<ExerciseRun>;
  onStart: () => void;
  onLog: (log: ExerciseLog) => void;
  onChainEvent: (event: ChainEvent) => void;
  onFinish: (result: ExerciseResult) => void;
}) => {
  let token: object | undefined;
  let current: ExerciseRun | undefined;
  let finished = true;

  const detach = () => {
    const previous = current;
    current = undefined;
    token = undefined;
    previous?.cancel();
  };

  return {
    isFinished: () => finished,
    cancel: () => {
      detach();
      finished = true;
    },
    run: async () => {
      detach();
      const own = {};
      token = own;
      finished = false;
      options.onStart();
      let launched: ExerciseRun;
      try {
        launched = await options.launch({
          onLog: (log) => {
            if (token === own) options.onLog(log);
          },
          onChainEvent: (event) => {
            if (token === own) options.onChainEvent(event);
          },
        });
      } catch (error) {
        if (token !== own) return;
        finished = true;
        options.onFinish({ status: "error", message: errorMessage(error) });
        return;
      }
      if (token !== own) {
        launched.cancel();
        return;
      }
      current = launched;
      const result = await launched.result;
      if (token !== own) return;
      current = undefined;
      finished = true;
      options.onFinish(result);
    },
  };
};
