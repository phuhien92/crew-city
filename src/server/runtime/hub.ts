import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getRuntimeAdapter, runtimeAdapterDescriptors } from "./adapters.js";
import {
  type ApprovalDecision,
  type RuntimeActivityEvent,
  type RuntimeAdapterDescriptor,
  type RuntimeApprovalRequestEvent,
  type RuntimeId,
  RuntimeRequestError,
} from "./contract.js";

export interface RuntimeActivityView extends RuntimeActivityEvent {
  runtime: RuntimeId;
}

export interface PendingApprovalView {
  requestId: string;
  runtime: RuntimeId;
  taskId: string;
  requestedAt: number;
  cwd: string;
  tool: {
    name: string;
    input: Record<string, unknown>;
  };
}

export interface RuntimeSnapshot {
  adapters: RuntimeAdapterDescriptor[];
  activities: Record<string, RuntimeActivityView>;
  approvals: PendingApprovalView[];
}

export interface RuntimeHttpResult {
  status: number;
  body: unknown;
}

interface SeenEvent {
  fingerprint: string;
  result: Promise<RuntimeHttpResult>;
  pendingRequestId?: string;
}

interface PendingApproval {
  view: PendingApprovalView;
  event: RuntimeApprovalRequestEvent;
  resolve: (result: RuntimeHttpResult) => void;
  timer: NodeJS.Timeout;
  settling: boolean;
}

export interface RuntimeHubOptions {
  auditPath: string;
  approvalTimeoutMs?: number;
  now?: () => number;
  id?: () => string;
}

/** Holds ephemeral runtime activity and blocking approvals. The firstmate ledger remains durable. */
export class RuntimeHub {
  private readonly approvalTimeoutMs: number;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly activities = new Map<string, RuntimeActivityView>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly seen = new Map<string, SeenEvent>();
  private readonly listeners = new Set<() => void>();
  private auditTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: RuntimeHubOptions) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    if (!Number.isFinite(this.approvalTimeoutMs) || this.approvalTimeoutMs < 1) {
      throw new Error("approvalTimeoutMs must be a positive number");
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RuntimeSnapshot {
    return {
      adapters: runtimeAdapterDescriptors(),
      activities: Object.fromEntries(this.activities),
      approvals: [...this.pending.values()]
        .map(({ view }) => view)
        .sort((a, b) => a.requestedAt - b.requestedAt || a.requestId.localeCompare(b.requestId)),
    };
  }

  /** Aborting `signal` means the runtime stopped waiting, so a pending approval it opened is denied. */
  async handleEvent(runtimeName: string, payload: unknown, signal?: AbortSignal): Promise<RuntimeHttpResult> {
    const adapter = getRuntimeAdapter(runtimeName);
    if (!adapter) throw new RuntimeRequestError("Unknown runtime adapter", 404);
    const event = adapter.parseEvent(payload);
    const key = `${adapter.descriptor.id}:${event.eventId}`;
    const fingerprint = JSON.stringify(event);
    const duplicate = this.seen.get(key);
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint) {
        throw new RuntimeRequestError("eventId was already used for a different event", 409);
      }
      return duplicate.result;
    }

    if (event.kind === "activity") {
      const result = Promise.resolve<RuntimeHttpResult>({ status: 202, body: { accepted: true } });
      this.seen.set(key, { fingerprint, result });
      const previous = this.activities.get(event.taskId);
      if (!previous || event.occurredAt >= previous.occurredAt) {
        this.activities.set(event.taskId, { ...event, runtime: adapter.descriptor.id });
        this.emitChange();
      }
      this.pruneSeen();
      return result;
    }

    const requestId = this.id();
    const view: PendingApprovalView = {
      requestId,
      runtime: adapter.descriptor.id,
      taskId: event.taskId,
      requestedAt: event.occurredAt,
      cwd: event.cwd,
      tool: event.tool,
    };
    let resolve!: (result: RuntimeHttpResult) => void;
    const result = new Promise<RuntimeHttpResult>((done) => {
      resolve = done;
    });
    const timer = setTimeout(() => {
      void this.settleApproval(requestId, "deny", "timeout", "No approval response before the timeout");
    }, this.approvalTimeoutMs);
    timer.unref?.();
    this.pending.set(requestId, { view, event, resolve, timer, settling: false });
    this.seen.set(key, { fingerprint, result, pendingRequestId: requestId });
    this.activities.set(event.taskId, {
      kind: "activity",
      eventId: event.eventId,
      taskId: event.taskId,
      occurredAt: event.occurredAt,
      state: "approval",
      summary: `Waiting for approval: ${event.tool.name}`,
      toolName: event.tool.name,
      cwd: event.cwd,
      runtime: adapter.descriptor.id,
    });
    this.emitChange();
    this.pruneSeen();
    const abandon = () => {
      void this.settleApproval(requestId, "deny", "abandoned", "The runtime stopped waiting for approval");
    };
    if (signal?.aborted) abandon();
    else signal?.addEventListener("abort", abandon, { once: true });
    return result;
  }

  async decide(requestId: string, decision: ApprovalDecision): Promise<boolean> {
    if (!this.pending.has(requestId)) return false;
    await this.settleApproval(
      requestId,
      decision,
      "user",
      decision === "approve" ? "Approved in Crew City" : "Denied in Crew City",
    );
    return true;
  }

  async close(): Promise<void> {
    for (const requestId of [...this.pending.keys()]) {
      await this.settleApproval(requestId, "deny", "shutdown", "Crew City shut down before approval");
    }
  }

  private async settleApproval(
    requestId: string,
    decision: ApprovalDecision,
    source: "user" | "timeout" | "shutdown" | "abandoned",
    reason: string,
  ): Promise<void> {
    const pending = this.pending.get(requestId);
    if (!pending || pending.settling) return;
    pending.settling = true;

    try {
      await this.appendAudit({
        v: 1,
        ts: Math.floor(this.now() / 1_000),
        event: "runtime.approval.decided",
        requestId,
        runtime: pending.view.runtime,
        task: pending.view.taskId,
        cwd: pending.view.cwd,
        tool: pending.view.tool,
        decision,
        source,
      });
    } catch (error) {
      pending.settling = false;
      if (decision === "approve") throw error;
      // A logging failure must never turn a denial into an approval or leave Pi running the tool.
      console.error(`Crew City could not write approval audit log: ${String(error)}`);
    }

    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    const adapter = getRuntimeAdapter(pending.view.runtime)!;
    pending.resolve(adapter.encodeApprovalDecision(decision, reason));
    this.activities.set(pending.view.taskId, {
      kind: "activity",
      eventId: pending.event.eventId,
      taskId: pending.view.taskId,
      occurredAt: this.now(),
      state: "approval",
      summary: `${decision === "approve" ? "Approved" : "Denied"}: ${pending.view.tool.name}`,
      toolName: pending.view.tool.name,
      cwd: pending.view.cwd,
      runtime: pending.view.runtime,
    });
    this.emitChange();
  }

  private appendAudit(record: Record<string, unknown>): Promise<void> {
    const write = this.auditTail
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.options.auditPath), { recursive: true, mode: 0o700 });
        await appendFile(this.options.auditPath, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
      });
    this.auditTail = write;
    return write;
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  private pruneSeen(): void {
    if (this.seen.size <= 2_000) return;
    for (const [key, value] of this.seen) {
      if (!value.pendingRequestId || !this.pending.has(value.pendingRequestId)) this.seen.delete(key);
      if (this.seen.size <= 1_500) break;
    }
  }
}
