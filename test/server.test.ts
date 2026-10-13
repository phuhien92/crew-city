import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PiBridgeClient } from "../src/pi/client.js";
import { CSP, startServer, type RunningServer } from "../src/server/server.js";

const TOKEN = "test-token-123";
const RUNTIME_TOKEN = "test-runtime-token-456";
const rec = (o: Record<string, unknown>) => JSON.stringify({ v: 1, ts: 1790200000, ...o }) + "\n";

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(initial = "", options: { approvalTimeoutMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "crew-city-it-"));
  const ledgerPath = join(dir, "fleet-ledger.jsonl");
  writeFileSync(ledgerPath, initial);
  server = await startServer({
    ledgerPath,
    auditPath: join(dir, "approval-audit.jsonl"),
    port: 0,
    token: TOKEN,
    runtimeToken: RUNTIME_TOKEN,
    pollMs: 50,
    approvalTimeoutMs: options.approvalTimeoutMs,
  });
  return server;
}

type Snapshot = {
  type: string;
  stats: Record<string, number>;
  districts: Record<string, Array<Record<string, unknown>>>;
  runtime: { approvals: Array<Record<string, unknown>>; activities: Record<string, Record<string, unknown>> };
};

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

const piEvent = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  event: "activity",
  eventId: "pi-event-1",
  taskId: "task-1",
  occurredAt: 1_790_200_000_000,
  cwd: "/tmp/project",
  activity: { state: "thinking", summary: "Thinking" },
  ...overrides,
});

function postRuntime(s: RunningServer, body: unknown, options: { token?: string; origin?: string; runtime?: string } = {}) {
  return fetch(`${s.url}/api/runtime/${options.runtime ?? "pi"}/events`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token ?? RUNTIME_TOKEN}`,
      "content-type": "application/json",
      ...(options.origin ? { origin: options.origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("server: page", () => {
  it("refuses a non-loopback bind", async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "crew-city-bind-")), "fleet-ledger.jsonl");
    writeFileSync(ledgerPath, "");
    await expect(startServer({ ledgerPath, host: "0.0.0.0", port: 0 })).rejects.toThrow("loopback");
  });

  it("refuses a runtime token equal to the browser token", async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), "crew-city-tokens-")), "fleet-ledger.jsonl");
    writeFileSync(ledgerPath, "");
    await expect(startServer({ ledgerPath, port: 0, token: "same", runtimeToken: "same" })).rejects.toThrow("differ");
  });

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

  it("rejects the runtime token, so an agent cannot open the approval channel", async () => {
    const s = await start();
    expect(await expectRejected(s, { token: RUNTIME_TOKEN })).toContain("401");
  });
});

describe("server: runtime event security", () => {
  it.each(["", "wrong"])("rejects a missing or wrong bearer token: %j", async (token) => {
    const s = await start();
    expect((await postRuntime(s, piEvent(), { token })).status).toBe(401);
  });

  it("rejects the browser token as a runtime credential", async () => {
    const s = await start();
    expect((await postRuntime(s, piEvent(), { token: TOKEN })).status).toBe(401);
  });

  it("rejects a foreign Origin even with the bearer token", async () => {
    const s = await start();
    expect((await postRuntime(s, piEvent(), { origin: "http://evil.example" })).status).toBe(403);
  });

  it("rejects malformed, colliding, and unsupported runtime events", async () => {
    const s = await start();
    expect((await postRuntime(s, { nope: true })).status).toBe(400);
    expect((await postRuntime(s, piEvent(), { runtime: "codex" })).status).toBe(501);
    expect((await postRuntime(s, piEvent())).status).toBe(202);
    expect((await postRuntime(s, piEvent())).status).toBe(202);
    expect((await postRuntime(s, piEvent({ activity: { state: "idle", summary: "Different" } }))).status).toBe(409);
  });
});

describe("server: Pi adapter", () => {
  it("adds live Pi activity without changing ledger lifecycle state", async () => {
    const dispatched = rec({ event: "task.dispatched", task: "task-1", kind: "ship", project: "webapp", harness: "pi", model: null });
    const s = await start(dispatched);
    const { ws, messages } = connect(s);
    await waitFor(() => messages[0]);

    const client = new PiBridgeClient({ baseUrl: s.url, token: RUNTIME_TOKEN, taskId: "task-1", id: () => "pi-client-activity" });
    await expect(client.activity({ state: "thinking", summary: "Thinking", cwd: "/tmp/project" })).resolves.toBe(true);
    const update = await waitFor(() => messages.find((message) => message.runtime.activities["task-1"]?.summary === "Thinking"));
    expect(update.districts.webapp![0]).toMatchObject({
      phase: "dispatched",
      liveActivity: { runtime: "pi", state: "thinking", summary: "Thinking" },
    });
    ws.close();
  });

  it("blocks for an explicit browser approval and audits the decision", async () => {
    const s = await start();
    const { ws, messages } = connect(s);
    await waitFor(() => messages[0]);
    const client = new PiBridgeClient({ baseUrl: s.url, token: RUNTIME_TOKEN, taskId: "task-1", id: () => "approval-1" });
    const response = client.requestApproval({
      toolCallId: "call-1",
      cwd: "/tmp/project",
      tool: { name: "bash", input: { command: "rm -rf build", timeout: 30 } },
    });
    const queued = await waitFor(() => messages.find((message) => message.runtime.approvals.length === 1));
    const requestId = queued.runtime.approvals[0]!.requestId as string;
    expect(queued.runtime.approvals[0]).toMatchObject({ taskId: "task-1", cwd: "/tmp/project", tool: { name: "bash" } });

    ws.send(JSON.stringify({ type: "approval.decision", requestId, decision: "approve" }));
    await expect(response).resolves.toMatchObject({ decision: "allow", reason: "Approved in Crew City" });
    await waitFor(() => messages.find((message) => message.runtime.approvals.length === 0 && message.runtime.activities["task-1"]?.summary === "Approved: bash"));

    expect(statSync(s.auditPath).mode & 0o777).toBe(0o600);
    const audit = JSON.parse(readFileSync(s.auditPath, "utf8").trim());
    expect(audit).toMatchObject({
      event: "runtime.approval.decided",
      requestId,
      runtime: "pi",
      decision: "approve",
      source: "user",
      tool: { name: "bash", input: { command: "rm -rf build", timeout: 30 } },
    });
    ws.close();
  });

  it.each(["Pi operation abort", "Pi client timeout"] as const)(
    "denies and clears the approval when Pi stops waiting: %s",
    async (cause) => {
      const s = await start();
      const { ws, messages } = connect(s);
      await waitFor(() => messages[0]);
      const controller = new AbortController();
      const client = new PiBridgeClient({
        baseUrl: s.url,
        token: RUNTIME_TOKEN,
        taskId: "task-1",
        id: () => "approval-abandoned",
        approvalTimeoutMs: cause === "Pi client timeout" ? 200 : 60_000,
      });
      const response = client.requestApproval(
        { toolCallId: "call-1", cwd: "/tmp/project", tool: { name: "bash", input: { command: "rm -rf build" } } },
        controller.signal,
      );
      const queued = await waitFor(() => messages.find((message) => message.runtime?.approvals.length === 1));
      const requestId = queued.runtime.approvals[0]!.requestId as string;
      if (cause === "Pi operation abort") controller.abort();
      await expect(response).resolves.toMatchObject({ decision: "deny" });

      await waitFor(() =>
        messages.find((message) => message.runtime?.approvals.length === 0 && message.runtime.activities["task-1"]?.summary === "Denied: bash"),
      );
      expect(JSON.parse(readFileSync(s.auditPath, "utf8").trim())).toMatchObject({ requestId, decision: "deny", source: "abandoned" });

      ws.send(JSON.stringify({ type: "approval.decision", requestId, decision: "approve" }));
      await waitFor(() => messages.find((message) => message.type === "approval.error"));
      expect(readFileSync(s.auditPath, "utf8").trim().split("\n")).toHaveLength(1);
      ws.close();
    },
  );

  it("denies when nobody responds", async () => {
    const s = await start("", { approvalTimeoutMs: 20 });
    const result = await postRuntime(
      s,
      piEvent({
        event: "approval.request",
        eventId: "approval-timeout",
        toolCallId: "call-timeout",
        tool: { name: "write", input: { path: "file.txt", content: "x" } },
      }),
    );
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({ decision: "deny", reason: expect.stringContaining("timeout") });
    expect(JSON.parse(readFileSync(s.auditPath, "utf8").trim())).toMatchObject({ decision: "deny", source: "timeout" });
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
