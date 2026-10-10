import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CSP, startServer, type RunningServer } from "../src/server/server.js";

const TOKEN = "test-token-123";
const rec = (o: Record<string, unknown>) => JSON.stringify({ v: 1, ts: 1790200000, ...o }) + "\n";

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(initial = "") {
  const ledgerPath = join(mkdtempSync(join(tmpdir(), "crew-city-it-")), "fleet-ledger.jsonl");
  writeFileSync(ledgerPath, initial);
  server = await startServer({ ledgerPath, port: 0, token: TOKEN, pollMs: 50 });
  return server;
}

type Snapshot = { type: string; stats: Record<string, number>; districts: Record<string, Array<Record<string, unknown>>> };

/** Opens a socket and collects every snapshot it receives. */
function connect(s: RunningServer, opts: { token?: string; origin?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${encodeURIComponent(opts.token ?? TOKEN)}`, {
    origin: opts.origin ?? s.url,
  });
  const messages: Snapshot[] = [];
  ws.on("message", (d) => messages.push(JSON.parse(String(d))));
  return { ws, messages };
}

/** Resolves with the 401 when the server refuses the upgrade, and fails if it accepts. */
function expectRejected(s: RunningServer, opts: { token?: string; origin?: string }) {
  const { ws } = connect(s, opts);
  return new Promise<string>((resolve, reject) => {
    ws.on("open", () => reject(new Error("connection was accepted")));
    ws.on("error", (e) => resolve(e.message));
  });
}

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("server: page", () => {
  it("serves the page with a content security policy", async () => {
    const s = await start();
    const res = await fetch(s.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(await res.text()).toContain("<title>Crew City</title>");
  });

  it("serves nothing else", async () => {
    const s = await start();
    for (const path of ["/package.json", "/src/server/server.ts", "/%2e%2e/package.json", "/public/index.html"]) {
      expect((await fetch(s.url + path)).status, path).toBe(404);
    }
  });
});

describe("server: live feed auth", () => {
  it("rejects a wrong token", async () => {
    const s = await start();
    expect(await expectRejected(s, { token: "wrong" })).toContain("401");
  });

  it("rejects a missing token", async () => {
    const s = await start();
    expect(await expectRejected(s, { token: "" })).toContain("401");
  });

  it("rejects another website's origin even with the right token", async () => {
    const s = await start();
    expect(await expectRejected(s, { origin: "http://evil.example" })).toContain("401");
  });
});

describe("server: live feed", () => {
  it("sends the replayed city on connect", async () => {
    const s = await start(rec({ event: "task.dispatched", task: "fix-login", kind: "ship", project: "webapp", harness: "claude", model: null }));
    const { ws, messages } = connect(s);
    const first = await waitFor(() => messages.find((m) => m.districts.webapp));
    expect(first.districts.webapp![0]).toMatchObject({ id: "fix-login", phase: "dispatched" });
    ws.close();
  });

  it("pushes updates as the ledger grows", async () => {
    const s = await start();
    const { ws, messages } = connect(s);
    await waitFor(() => messages[0]);

    appendFileSync(s.ledgerPath, rec({ event: "task.dispatched", task: "t1", kind: "ship", project: "api", harness: "claude", model: null }));
    appendFileSync(s.ledgerPath, rec({ event: "task.status", task: "t1", state: "failed", key: null, text: " 3 tests failing" }));

    const last = await waitFor(() => {
      const m = messages.at(-1);
      return m?.stats.fires === 1 ? m : undefined;
    });
    expect(last.districts.api![0]).toMatchObject({ id: "t1", phase: "failed", activity: "3 tests failing" });
    ws.close();
  });
});
