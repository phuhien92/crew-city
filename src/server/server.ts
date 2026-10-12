// The Crew City server as a function, so the CLI, tests, and later the
// desktop app's main process can all start it the same way.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { LedgerTailer } from "./ledger.js";
import { applyEvent, cityStats, districts, emptyCity } from "./city.js";
import { RuntimeHub } from "./runtime/hub.js";
import { RuntimeRequestError } from "./runtime/contract.js";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const MAX_RUNTIME_BODY = 256 * 1024;

export const CSP =
  "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

export interface ServerOptions {
  ledgerPath: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Browser credential for the live feed and approval decisions. Random when omitted. */
  token?: string;
  /** Runtime-event credential for agent adapters; it cannot open the browser feed. Random when omitted. */
  runtimeToken?: string;
  /** How often the tailer polls as a backstop to file watching. */
  pollMs?: number;
  /** Approval audit JSONL. Defaults outside the firstmate home. */
  auditPath?: string;
  /** Blocking approval timeout; expiration denies the tool call. */
  approvalTimeoutMs?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  runtimeToken: string;
  ledgerPath: string;
  auditPath: string;
  close(): Promise<void>;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || (!!req.headers.host && origin === `http://${req.headers.host}`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if ((req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase() !== "application/json") {
    throw new RuntimeRequestError("Content-Type must be application/json", 415);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_RUNTIME_BODY) throw new RuntimeRequestError("Event body is too large", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuntimeRequestError("Event body is not valid JSON", 400);
  }
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Crew City only binds to a loopback host");
  }
  const urlHost = host === "::1" ? "[::1]" : host;
  const token = opts.token ?? randomBytes(16).toString("hex");
  const runtimeToken = opts.runtimeToken ?? randomBytes(16).toString("hex");
  if (token === runtimeToken) {
    throw new Error("The runtime token must differ from the browser token");
  }
  const { ledgerPath } = opts;
  const auditPath = opts.auditPath ?? join(homedir(), ".crew-city", "approval-audit.jsonl");

  const tokenMatches = (given: string | null, expected: string) => {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const bearerOk = (authorization: string | undefined) => {
    const match = /^Bearer (.+)$/.exec(authorization ?? "");
    return tokenMatches(match?.[1] ?? null, runtimeToken);
  };

  const city = emptyCity();
  const hub = new RuntimeHub({ auditPath, approvalTimeoutMs: opts.approvalTimeoutMs });
  const snapshot = () => {
    const runtime = hub.snapshot();
    const districtView = Object.fromEntries(
      Object.entries(districts(city)).map(([name, tasks]) => [
        name,
        tasks.map((task) => ({ ...task, liveActivity: runtime.activities[task.id] ?? null })),
      ]),
    );
    const stats = cityStats(city);
    return JSON.stringify({
      type: "city",
      ledgerPath,
      stats: { ...stats, needsYou: stats.needsYou + runtime.approvals.length },
      districts: districtView,
      runtime,
    });
  };

  const clients = new Set<WebSocket>();
  let pending: NodeJS.Timeout | null = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = snapshot();
      for (const client of clients) {
        if (client.readyState === 1) client.send(msg);
      }
    }, 50);
  };
  const stopHubListener = hub.onChange(broadcast);

  const tailer = new LedgerTailer(
    ledgerPath,
    (event) => {
      applyEvent(city, event);
      broadcast();
    },
    opts.pollMs,
  );
  await tailer.start();

  const server: Server = createServer((req, res) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        res.writeHead(400).end("Bad request");
        return;
      }

      const runtimeMatch = /^\/api\/runtime\/([^/]+)\/events$/.exec(url.pathname);
      if (runtimeMatch) {
        if (req.method !== "POST") {
          res.writeHead(405, { allow: "POST" }).end("Method not allowed");
          return;
        }
        if (!sameOrigin(req)) {
          json(res, 403, { error: "Foreign Origin is not allowed" });
          return;
        }
        if (!bearerOk(req.headers.authorization)) {
          json(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const result = await hub.handleEvent(runtimeMatch[1]!, await readJson(req));
          json(res, result.status, result.body);
        } catch (error) {
          const status = error instanceof RuntimeRequestError ? error.status : 500;
          const message = error instanceof RuntimeRequestError ? error.message : "Runtime event failed";
          json(res, status, { error: message });
        }
        return;
      }

      if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
        const html = await readFile(join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
        res.end(html);
        return;
      }
      res.writeHead(404).end("Not found");
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end("Internal server error");
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !sameOrigin(req) || !tokenMatches(url.searchParams.get("token"), token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let message: unknown;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        const decision = message as Record<string, unknown>;
        if (
          decision.type !== "approval.decision" ||
          typeof decision.requestId !== "string" ||
          (decision.decision !== "approve" && decision.decision !== "deny")
        ) {
          return;
        }
        void hub.decide(decision.requestId, decision.decision).then(
          (accepted) => {
            if (!accepted && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "approval.error", requestId: decision.requestId, error: "Approval is no longer pending" }));
            }
          },
          () => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "approval.error", requestId: decision.requestId, error: "Decision was not recorded" }));
            }
          },
        );
      });
      ws.send(snapshot());
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 4317, host, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://${urlHost}:${port}`,
    port,
    token,
    runtimeToken,
    ledgerPath,
    auditPath,
    async close() {
      tailer.stop();
      stopHubListener();
      await hub.close();
      if (pending) clearTimeout(pending);
      for (const client of clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
