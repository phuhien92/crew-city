import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeAdapter, runtimeAdapterDescriptors } from "../src/server/runtime/adapters.js";
import { RuntimeRequestError } from "../src/server/runtime/contract.js";
import { RuntimeHub } from "../src/server/runtime/hub.js";

const activity = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  event: "activity",
  eventId: "event-1",
  taskId: "task-1",
  occurredAt: 1_790_200_000_000,
  cwd: "/tmp/project",
  activity: { state: "thinking", summary: "Thinking" },
  ...overrides,
});

function hub() {
  const dir = mkdtempSync(join(tmpdir(), "crew-city-runtime-"));
  return new RuntimeHub({ auditPath: join(dir, "audit.jsonl"), id: () => "request-1" });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runtime adapter contract", () => {
  it("implements Pi and leaves the other runtimes behind explicit unsupported boundaries", () => {
    const descriptors = runtimeAdapterDescriptors();
    expect(descriptors.map((adapter) => adapter.id)).toEqual(["pi", "claude-code", "codex", "opencode"]);
    expect(descriptors[0]).toMatchObject({
      id: "pi",
      implementation: "available",
      capabilities: { liveActivity: { supported: true }, approvals: { supported: true, mode: "blocking" } },
    });
    for (const descriptor of descriptors.slice(1)) {
      expect(descriptor).toMatchObject({
        implementation: "boundary-only",
        capabilities: { liveActivity: { supported: false }, approvals: { supported: false, mode: "unsupported" } },
      });
    }
    expect(() => getRuntimeAdapter("codex")!.parseEvent(activity())).toThrowError(
      expect.objectContaining<Partial<RuntimeRequestError>>({ status: 501 }),
    );
    expect(getRuntimeAdapter("other")).toBeNull();
  });

  it.each([
    null,
    {},
    { ...activity(), v: 2 },
    { ...activity(), eventId: "" },
    { ...activity(), occurredAt: -1 },
    { ...activity(), activity: { state: "made-up", summary: "x" } },
    { ...activity(), event: "approval.request", toolCallId: "call", tool: { name: "bash", input: [] } },
  ])("rejects malformed Pi events: %j", (payload) => {
    expect(() => getRuntimeAdapter("pi")!.parseEvent(payload)).toThrowError(
      expect.objectContaining<Partial<RuntimeRequestError>>({ status: 400 }),
    );
  });
});

describe("runtime event hub", () => {
  it("accepts an activity only once and does not let an older event replace it", async () => {
    const runtime = hub();
    await expect(runtime.handleEvent("pi", activity())).resolves.toMatchObject({ status: 202 });
    await expect(runtime.handleEvent("pi", activity())).resolves.toMatchObject({ status: 202 });
    await runtime.handleEvent("pi", activity({ eventId: "event-2", occurredAt: 1, activity: { state: "idle", summary: "Old" } }));

    expect(runtime.snapshot().activities["task-1"]).toMatchObject({ summary: "Thinking", runtime: "pi" });
    await runtime.close();
  });

  it("rejects reuse of an event id with different content", async () => {
    const runtime = hub();
    await runtime.handleEvent("pi", activity());
    await expect(runtime.handleEvent("pi", activity({ activity: { state: "idle", summary: "Different" } }))).rejects.toMatchObject({ status: 409 });
    await runtime.close();
  });

  it("returns the same blocking result to duplicate approval deliveries", async () => {
    const runtime = hub();
    const request = {
      v: 1,
      event: "approval.request",
      eventId: "approval-1",
      taskId: "task-1",
      occurredAt: 1_790_200_000_000,
      toolCallId: "call-1",
      cwd: "/tmp/project",
      tool: { name: "write", input: { path: "a.txt", content: "hello" } },
    };
    const first = runtime.handleEvent("pi", request);
    const duplicate = runtime.handleEvent("pi", request);
    expect(runtime.snapshot().approvals).toHaveLength(1);

    await expect(runtime.decide("request-1", "deny")).resolves.toBe(true);
    await expect(first).resolves.toMatchObject({ body: { decision: "deny" } });
    await expect(duplicate).resolves.toMatchObject({ body: { decision: "deny" } });
    await runtime.close();
  });

  it("denies by default before Pi's fixed 300-second HTTP headers timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const dir = mkdtempSync(join(tmpdir(), "crew-city-runtime-"));
    const auditPath = join(dir, "audit.jsonl");
    const runtime = new RuntimeHub({ auditPath, id: () => "request-1" });
    let settled = false;
    const result = runtime
      .handleEvent("pi", {
        v: 1,
        event: "approval.request",
        eventId: "approval-default-timeout",
        taskId: "task-1",
        occurredAt: 1_790_200_000_000,
        toolCallId: "call-1",
        cwd: "/tmp/project",
        tool: { name: "bash", input: { command: "rm -rf build" } },
      })
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(4 * 60_000 - 1);
    expect(settled).toBe(false);
    expect(runtime.snapshot().approvals).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ status: 200, body: { decision: "deny" } });
    expect(JSON.parse(readFileSync(auditPath, "utf8").trim())).toMatchObject({ decision: "deny", source: "timeout" });
    expect(runtime.snapshot().approvals).toHaveLength(0);
  });
});
