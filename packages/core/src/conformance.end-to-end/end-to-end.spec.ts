import { describe, expect, it } from "vitest";

import { notifyAdapterBaseGroups } from "../conformance.notify-adapter/groups.ts";
import {
  notifyAdapterConformanceCases,
  notifyAdapterEndToEndConformanceCases,
} from "../conformance.notify-adapter/notify-adapter-cases.ts";
import {
  stateAdapterAsyncGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
} from "../conformance.state-adapter/groups.ts";
import {
  asyncStateAdapterConformanceCases,
  asyncStateAdapterEndToEndConformanceCases,
  concurrentStateAdapterConformanceCases,
  concurrentStateAdapterEndToEndConformanceCases,
  stateAdapterConformanceCases,
  stateAdapterEndToEndConformanceCases,
} from "../conformance.state-adapter/state-adapter-cases.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import { validationAdapterConformanceCases } from "../conformance.validation-adapter/validation-adapter-cases.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndNotifyGroups,
  notifyAdapterEndToEndGroups,
} from "./groups.ts";

const titlesOf = (groups: { name: string; cases: { name: string }[] }[]): string[] =>
  groups.flatMap((group) => group.cases.map((testCase) => `${group.name} > ${testCase.name}`));

const trackClose = <T extends { close: () => Promise<void> }>(
  adapter: T,
  closed: string[],
  label: string,
): T => {
  const close = async (): Promise<void> => {
    closed.push(label);
    await adapter.close();
  };
  return { ...adapter, close, [Symbol.asyncDispose]: close };
};

const findCase = <T extends { title: string }>(cases: T[], title: string): T => {
  const found = cases.find((conformanceCase) => conformanceCase.title === title);
  if (!found) throw new Error(`no case titled "${title}"`);
  return found;
};

describe("public case lists", () => {
  it("gives every case its own title across the lists an adapter runs together", () => {
    for (const cases of [
      [
        ...stateAdapterConformanceCases,
        ...asyncStateAdapterConformanceCases,
        ...concurrentStateAdapterConformanceCases,
        ...stateAdapterEndToEndConformanceCases,
        ...asyncStateAdapterEndToEndConformanceCases,
        ...concurrentStateAdapterEndToEndConformanceCases,
      ],
      [...notifyAdapterConformanceCases, ...notifyAdapterEndToEndConformanceCases],
      validationAdapterConformanceCases,
    ]) {
      const titles = cases.map(({ title }) => title);
      expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
    }
  });
});

describe("stateAdapterEndToEndConformanceCases", () => {
  it("keeps the contract cases and the end-to-end cases in separate lists", () => {
    expect(stateAdapterConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(stateAdapterBaseGroups),
    );
    expect(concurrentStateAdapterConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(stateAdapterConcurrentTransactionGroups),
    );
    expect(asyncStateAdapterConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(stateAdapterAsyncGroups),
    );
    expect(stateAdapterEndToEndConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf([...endToEndBaseGroups, ...endToEndNotifyGroups]),
    );
    expect(asyncStateAdapterEndToEndConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(endToEndAsyncGroups),
    );
    expect(concurrentStateAdapterEndToEndConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(endToEndConcurrentTransactionGroups),
    );
  });

  it("gives each case its own adapters from the context and closes them when it ends", async () => {
    const created: string[] = [];
    const closed: string[] = [];
    const context: StateAdapterConformanceContext = {
      createStateAdapter: async () => {
        created.push("state");
        return trackClose(
          createInProcessStateAdapter({ mode: "async" }) as StateAdapter<any, any, any, "async">,
          closed,
          "state",
        );
      },
      createNotifyAdapter: async () => {
        created.push("notify");
        return trackClose<NotifyAdapter<"async">>(
          createInProcessNotifyAdapter({ mode: "async" }),
          closed,
          "notify",
        );
      },
      withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
    };

    await findCase(stateAdapterEndToEndConformanceCases, "chains > handles chained jobs").run(
      context,
    );
    await findCase(
      stateAdapterEndToEndConformanceCases,
      "notify > schedules processing immediately",
    ).run(context);

    expect(created).toEqual(["state", "notify", "state", "notify"]);
    expect(closed.toSorted()).toEqual(["notify", "notify", "state", "state"]);
  });

  it("runs a notify case over an in-process notify adapter when the context creates none", async () => {
    const context: StateAdapterConformanceContext = {
      createStateAdapter: async () => createInProcessStateAdapter({ mode: "async" }),
      withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
    };

    for (const conformanceCase of stateAdapterEndToEndConformanceCases.filter(
      ({ group }) => group === "notify",
    )) {
      await conformanceCase.run(context);
    }
  });
});

describe("notifyAdapterEndToEndConformanceCases", () => {
  it("keeps the contract cases and the end-to-end notify cases in separate lists", () => {
    expect(notifyAdapterConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(notifyAdapterBaseGroups),
    );
    expect(notifyAdapterEndToEndConformanceCases.map(({ title }) => title)).toEqual(
      titlesOf(notifyAdapterEndToEndGroups),
    );
    expect(titlesOf(notifyAdapterEndToEndGroups)).toEqual(titlesOf(endToEndNotifyGroups));
  });

  it("runs each case over a notify adapter from the context and closes it when it ends", async () => {
    const created: string[] = [];
    const closed: string[] = [];
    const context = {
      createNotifyAdapter: async () => {
        const label = `notify ${created.length}`;
        created.push(label);
        return trackClose<NotifyAdapter<"async">>(
          createInProcessNotifyAdapter({ mode: "async" }),
          closed,
          label,
        );
      },
    };

    for (const conformanceCase of notifyAdapterEndToEndConformanceCases.filter(
      ({ group }) => group === "notify",
    )) {
      await conformanceCase.run(context);
    }

    expect(created).toHaveLength(
      notifyAdapterEndToEndConformanceCases.filter(({ group }) => group === "notify").length,
    );
    expect(new Set(closed)).toEqual(new Set(created));
  });

  it("closes the notify adapter when a case fails before taking it", async () => {
    const closed: string[] = [];
    const notifyAdapter = trackClose<NotifyAdapter<"async">>(
      createInProcessNotifyAdapter({ mode: "async" }),
      closed,
      "notify",
    );
    const context = {
      createNotifyAdapter: async () =>
        ({
          ...notifyAdapter,
          [Symbol.asyncDispose]: undefined,
        }) as unknown as NotifyAdapter<"async">,
    };

    await expect(notifyAdapterEndToEndConformanceCases[0].run(context)).rejects.toThrow(
      "A resource got a value that is neither async disposable nor disposable",
    );
    expect(closed).toEqual(["notify"]);
  });
});
