// The Crew City server as a function, so the CLI, tests, and later the
// desktop app's main process can all start it the same way.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { LedgerTailer } from "./ledger.js";
import { applyEvent, cityStats, districts, emptyCity } from "./city.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));

export const CSP =
  "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

export interface ServerOptions {
  ledgerPath: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Random when omitted. */
  token?: string;
  /** How often the tailer polls as a backstop to file watching. */
  pollMs?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  ledgerPath: string;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const token = opts.token ?? randomBytes(16).toString("hex");
  const { ledgerPath } = opts;

  // The token gates the live feed now and the approval actions later.
  const tokenOk = (given: string | null) => {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const city = emptyCity();
  const snapshot = () => JSON.stringify({ type: "city", ledgerPath, stats: cityStats(city), districts: districts(city) });

  const clients = new Set<WebSocket>();
  let pending: NodeJS.Timeout | null = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = snapshot();
      for (const c of clients) c.send(msg);
    }, 50); // coalesce bursts, e.g. the initial replay
  };

  const tailer = new LedgerTailer(
    ledgerPath,
    (e) => {
      applyEvent(city, e);
      broadcast();
    },
    opts.pollMs,
  );
  await tailer.start();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      res.writeHead(404).end("Not found");
      return;
    }
    const html = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
    res.end(html);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://${req.headers.host}`;
    if (url.pathname !== "/ws" || !sameOrigin || !tokenOk(url.searchParams.get("token"))) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.send(snapshot());
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 4317, host, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://${host}:${port}`,
    port,
    token,
    ledgerPath,
    async close() {
      tailer.stop();
      if (pending) clearTimeout(pending);
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
