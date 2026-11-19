import { type Socket, createConnection, createServer } from "node:net";

export type LatencyProxy = {
  host: string;
  port: number;
  close: () => Promise<void>;
};

export const startLatencyProxy = async ({
  targetHost,
  targetPort,
  roundTripMs,
}: {
  targetHost: string;
  targetPort: number;
  roundTripMs: number;
}): Promise<LatencyProxy> => {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  const forwardDelayed = (from: Socket, to: Socket) => {
    from.on("data", (chunk) => {
      setTimeout(() => {
        if (!to.destroyed) to.write(chunk);
      }, roundTripMs / 2);
    });
    from.on("end", () => {
      setTimeout(() => to.end(), roundTripMs / 2);
    });
    from.on("error", () => to.destroy());
  };

  const server = createServer((client) => {
    track(client);
    const upstream = createConnection({ host: targetHost, port: targetPort });
    track(upstream);
    upstream.setNoDelay(true);
    client.setNoDelay(true);
    forwardDelayed(client, upstream);
    forwardDelayed(upstream, client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the latency proxy did not bind a TCP port");
  }

  return {
    host: "127.0.0.1",
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
};
