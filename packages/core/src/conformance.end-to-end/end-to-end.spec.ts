import { describe, expect, it } from "vitest";

import { notifyAdapterBaseGroups } from "../conformance.notify-adapter/groups.ts";
import {
  createNotifyAdapterConformanceCases,
  createNotifyAdapterEndToEndConformanceCases,
} from "../conformance.notify-adapter/notify-adapter-cases.ts";
import {
  stateAdapterAsyncGroups,
  stateAdapterAsyncLockWaitGroups,
  stateAdapterBaseGroups,
  stateAdapterConcurrentTransactionGroups,
  stateAdapterConcurrentTransactionLockWaitGroups,
} from "../conformance.state-adapter/groups.ts";
import {
  createStateAdapterConformanceCases,
  createStateAdapterEndToEndConformanceCases,
} from "../conformance.state-adapter/state-adapter-cases.ts";
import type { StateAdapterConformanceContext } from "../conformance.state-adapter/types.ts";
import type { ValidationAdapterConformanceContext } from "../conformance.validation-adapter/types.ts";
import { createValidationAdapterConformanceCases } from "../conformance.validation-adapter/validation-adapter-cases.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateAdapter } from "../state-adapter/state-adapter.ts";
import {
  endToEndAsyncGroups,
  endToEndBaseGroups,
  endToEndConcurrentTransactionGroups,
  endToEndConcurrentTransactionLockWaitGroups,
  endToEndNotifyConcurrentTransactionGroups,
  endToEndNotifyGroups,
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

const stateContext: StateAdapterConformanceContext = {
  createStateAdapter: async () => createInProcessStateAdapter({ mode: "async" }),
  withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
};
const notifyContext = {
  createNotifyAdapter: async () => createInProcessNotifyAdapter({ mode: "async" }),
  mode: "async" as const,
};

describe("public case lists", () => {
  it("gives every case its own title across the lists an adapter runs together", () => {
    for (const cases of [
      [
        ...createStateAdapterConformanceCases({ ...stateContext, mode: "async", concurrent: true }),
        ...createStateAdapterEndToEndConformanceCases({
          ...stateContext,
          mode: "async",
          concurrent: true,
        }),
      ],
      [
        ...createNotifyAdapterConformanceCases(notifyContext),
        ...createNotifyAdapterEndToEndConformanceCases(notifyContext),
      ],
      createValidationAdapterConformanceCases({} as ValidationAdapterConformanceContext),
    ]) {
      const titles = cases.map(({ title }) => title);
      expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
    }
  });
});

describe("createStateAdapterEndToEndConformanceCases", () => {
  it("chooses the contract and end-to-end cases by mode and concurrency", () => {
    const titles = (cases: { title: string }[]) => cases.map(({ title }) => title);

    expect(titles(createStateAdapterConformanceCases({ ...stateContext, mode: "sync" }))).toEqual(
      titlesOf(stateAdapterBaseGroups),
    );
    expect(titles(createStateAdapterConformanceCases({ ...stateContext, mode: "async" }))).toEqual(
      titlesOf([
        ...stateAdapterBaseGroups,
        ...stateAdapterAsyncGroups,
        ...stateAdapterAsyncLockWaitGroups,
      ]),
    );
    expect(
      titles(
        createStateAdapterConformanceCases({ ...stateContext, mode: "sync", concurrent: true }),
      ),
    ).toEqual(
      titlesOf([
        ...stateAdapterBaseGroups,
        ...stateAdapterConcurrentTransactionGroups,
        ...stateAdapterConcurrentTransactionLockWaitGroups,
      ]),
    );
    expect(
      titles(createStateAdapterEndToEndConformanceCases({ ...stateContext, mode: "sync" })),
    ).toEqual(titlesOf([...endToEndBaseGroups, ...endToEndNotifyGroups]));
    expect(
      titles(
        createStateAdapterEndToEndConformanceCases({
          ...stateContext,
          mode: "async",
          concurrent: true,
        }),
      ),
    ).toEqual(
      titlesOf([
        ...endToEndBaseGroups,
        ...endToEndNotifyGroups,
        ...endToEndAsyncGroups,
        ...endToEndConcurrentTransactionGroups,
        ...endToEndConcurrentTransactionLockWaitGroups,
        ...endToEndNotifyConcurrentTransactionGroups,
      ]),
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

    const cases = createStateAdapterEndToEndConformanceCases({ ...context, mode: "async" });
    await findCase(cases, "chains > handles chained jobs").run();
    await findCase(cases, "notify > schedules processing immediately").run();

    expect(created).toEqual(["state", "notify", "state", "notify"]);
    expect(closed.toSorted()).toEqual(["notify", "notify", "state", "state"]);
  });

  it("runs a notify case over an in-process notify adapter when the context creates none", async () => {
    const context: StateAdapterConformanceContext = {
      createStateAdapter: async () => createInProcessStateAdapter({ mode: "async" }),
      withNonTransactionContext: async (fn) => fn({ outsideTransaction: true }),
    };

    for (const conformanceCase of createStateAdapterEndToEndConformanceCases({
      ...context,
      mode: "async",
    }).filter(({ group }) => group === "notify")) {
      await conformanceCase.run();
    }
  });
});

describe("createNotifyAdapterEndToEndConformanceCases", () => {
  it("keeps the contract cases and the end-to-end notify cases in separate lists", () => {
    expect(createNotifyAdapterConformanceCases(notifyContext).map(({ title }) => title)).toEqual(
      titlesOf(notifyAdapterBaseGroups),
    );
    expect(
      createNotifyAdapterEndToEndConformanceCases(notifyContext).map(({ title }) => title),
    ).toEqual(titlesOf(endToEndNotifyGroups));
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
      mode: "async" as const,
    };

    const notifyCases = createNotifyAdapterEndToEndConformanceCases(context).filter(
      ({ group }) => group === "notify",
    );
    for (const conformanceCase of notifyCases) {
      await conformanceCase.run();
    }

    expect(created).toHaveLength(notifyCases.length);
    expect(new Set(closed)).toEqual(new Set(created));
  });
});
