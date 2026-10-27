// A minimal Chrome DevTools Protocol client over Node's WebSocket, for `cw verify trace`: one
// connection to a browser's endpoint, with page sessions attached through it (`flatten: true`), so
// every command names the `sessionId` it goes to. Node runs the CLIs that import this directly
// (type stripping), so relative imports keep their `.ts` extension.

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

type SendArgs = { method: string; params?: Record<string, unknown>; sessionId?: string };

export type Cdp = {
  send: (args: SendArgs) => Promise<Record<string, unknown>>;
  /** Calls `listener` with every event until the returned function is called. */
  on: (listener: (event: CdpEvent) => void) => () => void;
  close: () => void;
};

type Reply = { id: number; result?: Record<string, unknown>; error?: { message: string } };

export async function connectCdp(url: string): Promise<Cdp> {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`can't reach ${url}`)), {
      once: true,
    });
  });
  let lastId = 0;
  const pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const listeners = new Set<(event: CdpEvent) => void>();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data)) as Partial<Reply> & Partial<CdpEvent>;
    if (message.id !== undefined) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result ?? {});
    } else if (message.method) {
      const event = { method: message.method, params: message.params ?? {}, ...(message.sessionId && { sessionId: message.sessionId }) };
      for (const listener of listeners) listener(event);
    }
  });
  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) reject(new Error("the browser closed the connection"));
    pending.clear();
  });
  return {
    send: ({ method, params = {}, sessionId }) =>
      new Promise((resolve, reject) => {
        lastId += 1;
        pending.set(lastId, { resolve, reject });
        socket.send(JSON.stringify({ id: lastId, method, params, ...(sessionId && { sessionId }) }));
      }),
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => socket.close(),
  };
}
