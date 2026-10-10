export const RUNTIME_IDS = ["pi", "claude-code", "codex", "opencode"] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];
export type ActivityState = "session" | "thinking" | "tool" | "idle" | "approval";
export type ApprovalDecision = "approve" | "deny";

export type CapabilitySupport = { supported: true } | { supported: false; reason: string };
export type ApprovalCapability =
  | { supported: true; mode: "blocking" }
  | { supported: false; mode: "unsupported"; reason: string };

export interface RuntimeAdapterDescriptor {
  id: RuntimeId;
  label: string;
  implementation: "available" | "boundary-only";
  capabilities: {
    liveActivity: CapabilitySupport;
    approvals: ApprovalCapability;
  };
}

export interface RuntimeActivityEvent {
  kind: "activity";
  eventId: string;
  taskId: string;
  occurredAt: number;
  state: ActivityState;
  summary: string;
  toolName: string | null;
  cwd: string | null;
}

export interface RuntimeApprovalRequestEvent {
  kind: "approval-request";
  eventId: string;
  taskId: string;
  occurredAt: number;
  toolCallId: string;
  cwd: string;
  tool: {
    name: string;
    input: Record<string, unknown>;
  };
}

export type RuntimeEvent = RuntimeActivityEvent | RuntimeApprovalRequestEvent;

export interface EncodedApprovalDecision {
  status: number;
  body: unknown;
}

/** Runtime-specific parsing and response encoding stops at this boundary. */
export interface RuntimeAdapter {
  descriptor: RuntimeAdapterDescriptor;
  parseEvent(payload: unknown): RuntimeEvent;
  encodeApprovalDecision(decision: ApprovalDecision, reason: string): EncodedApprovalDecision;
}

export class RuntimeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RuntimeRequestError";
  }
}
