import { describe, expect, it, vi } from "vitest";
import { PiBridgeClient, toolNeedsApproval } from "../src/pi/client.js";

const configured = (fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) =>
  new PiBridgeClient({
    baseUrl: "http://127.0.0.1:4317",
    token: "secret",
    taskId: "task-7",
    fetch: fetchImpl,
    now: () => 1_790_200_000_000,
    id: () => "event-7",
    ...overrides,
  });

describe("Pi approval policy", () => {
  it("does not gate explicitly read-only tools", () => {
    expect(toolNeedsApproval({ readOnlyHint: true })).toBe(false);
  });

  it("gates destructive, open-world, and unannotated tools while honoring explicit safe hints", () => {
    expect(toolNeedsApproval({ destructiveHint: true })).toBe(true);
    expect(toolNeedsApproval({ openWorldHint: true })).toBe(true);
    expect(toolNeedsApproval({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })).toBe(false);
    expect(toolNeedsApproval(undefined)).toBe(true);
  });
});

describe("Pi bridge client", () => {
  it("sends normalized activity with bearer authentication", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })) as unknown as typeof fetch;
    const client = configured(fetchImpl);

    await expect(client.activity({ state: "thinking", summary: "Thinking", cwd: "/tmp/project" })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4317/api/runtime/pi/events");
    expect(init.headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toMatchObject({
      event: "activity",
      eventId: "event-7",
      taskId: "task-7",
      occurredAt: 1_790_200_000_000,
      activity: { state: "thinking", summary: "Thinking" },
    });
  });

  it.each([
    [new Response(JSON.stringify({ v: 1, decision: "allow", reason: "ok" }), { status: 200 }), "allow"],
    [new Response(JSON.stringify({ v: 1, decision: "deny", reason: "no" }), { status: 200 }), "deny"],
  ] as const)("accepts an explicit %s decision", async (response, decision) => {
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    const client = configured(fetchImpl);
    await expect(
      client.requestApproval({ toolCallId: "call-1", cwd: "/tmp/project", tool: { name: "bash", input: { command: "npm test" } } }),
    ).resolves.toMatchObject({ decision });
  });

  it("denies malformed responses rather than defaulting to approval", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ decision: "allow" }), { status: 200 })) as unknown as typeof fetch;
    const client = configured(fetchImpl);
    await expect(
      client.requestApproval({ toolCallId: "call-1", cwd: "/tmp/project", tool: { name: "write", input: { path: "x" } } }),
    ).resolves.toMatchObject({ decision: "deny", reason: expect.stringContaining("unavailable") });
  });

  it("reads only the runtime token from the environment", () => {
    const base = { CREW_CITY_URL: "http://127.0.0.1:4317", CREW_CITY_TASK_ID: "task" };
    expect(PiBridgeClient.fromEnvironment({ ...base, CREW_CITY_TOKEN: "browser" }).configurationError).toBe(
      "CREW_CITY_RUNTIME_TOKEN is missing",
    );
    expect(PiBridgeClient.fromEnvironment({ ...base, CREW_CITY_RUNTIME_TOKEN: "runtime" }).configurationError).toBeNull();
  });

  it("denies when configuration is missing or the URL is not loopback", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const baseUrl of [undefined, "https://127.0.0.1:4317", "http://example.com:4317", "http://127.0.0.1:4317/not-crew-city"]) {
      const client = new PiBridgeClient({ baseUrl, token: "secret", taskId: "task", fetch: fetchImpl });
      await expect(
        client.requestApproval({ toolCallId: "call", cwd: "/tmp", tool: { name: "bash", input: { command: "true" } } }),
      ).resolves.toMatchObject({ decision: "deny" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["timeout", "Pi operation abort"] as const)("denies on %s", async (cause) => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch;
    const controller = new AbortController();
    const client = configured(fetchImpl, { approvalTimeoutMs: cause === "timeout" ? 5 : 1_000 });
    if (cause === "Pi operation abort") setTimeout(() => controller.abort(), 5);
    await expect(
      client.requestApproval(
        { toolCallId: "call", cwd: "/tmp", tool: { name: "bash", input: { command: "true" } } },
        cause === "Pi operation abort" ? controller.signal : undefined,
      ),
    ).resolves.toMatchObject({ decision: "deny" });
  });
});
