// Crew City server: follows firstmate's fleet ledger and pushes city state to the browser.
//
//   FM_HOME=~/firstmate npm start     follow a real firstmate home
//   npm run demo                       replay a scripted fleet into a temp ledger

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { LedgerTailer } from "./ledger.js";
import { applyEvent, cityStats, districts, emptyCity } from "./city.js";
import { startDemo } from "./demo.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4317);
const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));

const demo = process.argv.includes("--demo");
const expand = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const ledgerPath = demo
  ? await startDemo()
  : resolve(expand(process.env.LEDGER ?? join(process.env.FM_HOME ?? "~/firstmate", "state/fleet-ledger.jsonl")));

// The token gates the live feed now and the approval actions later.
const TOKEN = process.env.CREW_CITY_TOKEN ?? randomBytes(16).toString("hex");
const tokenOk = (given: string | null) => {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
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

const tailer = new LedgerTailer(ledgerPath, (e) => {
  applyEvent(city, e);
  broadcast();
});
await tailer.start();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/" && url.pathname !== "/index.html") {
    res.writeHead(404).end("Not found");
    return;
  }
  const html = await readFile(join(PUBLIC_DIR, "index.html"));
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
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

server.listen(PORT, HOST, () => {
  console.log(`Crew City following ${ledgerPath}${demo ? " (demo)" : ""}`);
  console.log(`Open http://${HOST}:${PORT}/?token=${TOKEN}`);
  console.log("Keep that URL private: the token will authorize approvals in later steps.");
});

const shutdown = () => {
  tailer.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
