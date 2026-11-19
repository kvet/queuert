import { once } from "node:events";
import { createConnection, createServer } from "node:net";

import { expect, it } from "vitest";

import { startLatencyProxy } from "./latency-proxy.ts";

it("forwards bytes both ways and adds the round-trip delay", async () => {
  const echo = createServer((socket) => socket.pipe(socket));
  echo.listen(0, "127.0.0.1");
  await once(echo, "listening");
  const { port: targetPort } = echo.address() as { port: number };
  const proxy = await startLatencyProxy({ targetHost: "127.0.0.1", targetPort, roundTripMs: 100 });

  try {
    const client = createConnection({ host: proxy.host, port: proxy.port });
    await once(client, "connect");
    const startedAt = performance.now();
    client.write("ping");
    const [reply] = (await once(client, "data")) as [Buffer];
    const elapsed = performance.now() - startedAt;
    client.destroy();

    expect(reply.toString()).toBe("ping");
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(180);
  } finally {
    await proxy.close();
    echo.close();
  }
});
