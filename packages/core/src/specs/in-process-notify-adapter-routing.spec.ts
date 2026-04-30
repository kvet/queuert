import { describe, expect, it } from "vitest";

import { createInProcessNotifyAdapter } from "../notify-adapter/notify-adapter.in-process.js";

describe("In-Process Notify Adapter — indexed routing", () => {
  it("dispatch cost is independent of unrelated listener count (indexed by id)", async () => {
    const adapter = await createInProcessNotifyAdapter();

    const targetCalls = { count: 0 };
    let unrelatedCalls = 0;

    const N = 5_000;
    const disposes: (() => Promise<void>)[] = [];
    for (let i = 0; i < N; i++) {
      disposes.push(
        await adapter.listenChainCompleted(`chain-${i}`, () => {
          unrelatedCalls++;
        }),
      );
    }
    disposes.push(
      await adapter.listenChainCompleted("chain-target", () => {
        targetCalls.count++;
      }),
    );

    await adapter.notifyChainCompleted("chain-target");

    expect(targetCalls.count).toBe(1);
    expect(unrelatedCalls).toBe(0);

    for (const dispose of disposes) await dispose();
    await adapter.close();
  });

  it("multiple listeners on same chain id all fire; disposing one leaves the other", async () => {
    const adapter = await createInProcessNotifyAdapter();

    let aCalls = 0;
    let bCalls = 0;

    const disposeA = await adapter.listenChainCompleted("c", () => {
      aCalls++;
    });
    const disposeB = await adapter.listenChainCompleted("c", () => {
      bCalls++;
    });

    await adapter.notifyChainCompleted("c");
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);

    await disposeA();
    await adapter.notifyChainCompleted("c");
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(2);

    await disposeB();
    await adapter.close();
  });

  it("listenJobScheduled with multiple type names registers under each", async () => {
    const adapter = await createInProcessNotifyAdapter();

    const seen: string[] = [];
    const dispose = await adapter.listenJobScheduled(["a", "b"], (typeName) => {
      seen.push(typeName);
    });

    await adapter.notifyJobScheduled("a");
    await adapter.notifyJobScheduled("b");
    await adapter.notifyJobScheduled("c");

    expect(seen).toEqual(["a", "b"]);

    await dispose();
    await adapter.notifyJobScheduled("a");
    expect(seen).toEqual(["a", "b"]);

    await adapter.close();
  });

  it("unsubscribing during notification iteration does not skip peer listeners", async () => {
    const adapter = await createInProcessNotifyAdapter();

    let peerCalls = 0;

    let disposeSelf: (() => Promise<void>) | null = null;
    disposeSelf = await adapter.listenChainCompleted("c", () => {
      void disposeSelf?.();
    });
    const disposePeer = await adapter.listenChainCompleted("c", () => {
      peerCalls++;
    });

    await adapter.notifyChainCompleted("c");
    expect(peerCalls).toBe(1);

    await disposePeer();
    await adapter.close();
  });
});
