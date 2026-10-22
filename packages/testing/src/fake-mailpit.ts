import { once } from "node:events";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { text } from "node:stream/consumers";

export interface FakeServer {
  url: string;
  close: () => Promise<void>;
}

/** An HTTP server on a free loopback port. */
export async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<FakeServer> {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind a port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

export function readBody(request: IncomingMessage): Promise<string> {
  return text(request);
}

export interface FakeMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Received time; defaults to now. */
  created?: Date;
}

/**
 * The slice of Mailpit's v1 API the harness uses (search and message), in memory. Like the real
 * one, `to:` search matches substrings (case-insensitively), so exact-recipient filtering is the client's job.
 */
export async function startFakeMailpit(options: { auth?: string } = {}) {
  // Newest first, as Mailpit sorts its results.
  const messages: Array<Required<FakeMail> & { id: string }> = [];

  const server = await listen((request, response) => {
    const url = new URL(request.url ?? "/", "http://mailpit");
    response.setHeader("content-type", "application/json");
    if (
      options.auth &&
      request.headers.authorization !== `Basic ${Buffer.from(options.auth).toString("base64")}`
    ) {
      response.statusCode = 401;
      response.end("{}");
      return;
    }

    if (url.pathname === "/api/v1/search") {
      const to = /^to:"(.*)"$/.exec(url.searchParams.get("query") ?? "")?.[1]?.toLowerCase() ?? "";
      const found = messages
        .filter((message) => message.to.toLowerCase().includes(to))
        .map((message) => ({
          ID: message.id,
          Subject: message.subject,
          To: [{ Name: "", Address: message.to }],
          Created: message.created.toISOString(),
        }));
      response.end(JSON.stringify({ messages: found, messages_count: found.length }));
      return;
    }

    const id = /^\/api\/v1\/message\/([^/]+)$/.exec(url.pathname)?.[1];
    const message = messages.find((candidate) => candidate.id === id);
    if (!message) {
      response.statusCode = 404;
      response.end("{}");
      return;
    }
    response.end(
      JSON.stringify({
        ID: message.id,
        Subject: message.subject,
        To: [{ Name: "", Address: message.to }],
        Text: message.text,
        HTML: message.html,
        Date: message.created.toISOString(),
      }),
    );
  });

  return {
    ...server,
    deliver(mail: FakeMail): string {
      const id = `msg${messages.length + 1}`;
      messages.unshift({ html: "", created: new Date(), ...mail, id });
      return id;
    },
  };
}
