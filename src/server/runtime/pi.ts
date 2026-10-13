import {
  type ActivityState,
  type ApprovalDecision,
  type RuntimeAdapter,
  type RuntimeEvent,
  RuntimeRequestError,
} from "./contract.js";

const ACTIVITY_STATES = new Set<ActivityState>(["session", "thinking", "tool", "idle", "approval"]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeRequestError("Event body must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

function stringMember(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new RuntimeRequestError(`${name} must be a non-empty string of at most ${max} characters`, 400);
  }
  return value;
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value == null) return null;
  return stringMember(value, name, max);
}

function occurredAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RuntimeRequestError("occurredAt must be a non-negative integer", 400);
  }
  return value;
}

export const piAdapter: RuntimeAdapter = {
  descriptor: {
    id: "pi",
    label: "Pi",
    implementation: "available",
    capabilities: {
      liveActivity: { supported: true },
      approvals: { supported: true, mode: "blocking" },
    },
  },

  parseEvent(payload: unknown): RuntimeEvent {
    const body = record(payload);
    if (body.v !== 1) throw new RuntimeRequestError("Unsupported Pi event version", 400);
    const eventId = stringMember(body.eventId, "eventId", 128);
    const taskId = stringMember(body.taskId, "taskId", 256);
    const at = occurredAt(body.occurredAt);

    if (body.event === "activity") {
      const activity = record(body.activity);
      if (typeof activity.state !== "string" || !ACTIVITY_STATES.has(activity.state as ActivityState)) {
        throw new RuntimeRequestError("activity.state is not supported", 400);
      }
      return {
        kind: "activity",
        eventId,
        taskId,
        occurredAt: at,
        state: activity.state as ActivityState,
        summary: stringMember(activity.summary, "activity.summary", 4_000),
        toolName: optionalString(activity.toolName, "activity.toolName", 256),
        cwd: optionalString(body.cwd, "cwd", 4_096),
      };
    }

    if (body.event === "approval.request") {
      const tool = record(body.tool);
      return {
        kind: "approval-request",
        eventId,
        taskId,
        occurredAt: at,
        toolCallId: stringMember(body.toolCallId, "toolCallId", 256),
        cwd: stringMember(body.cwd, "cwd", 4_096),
        tool: {
          name: stringMember(tool.name, "tool.name", 256),
          input: record(tool.input),
        },
      };
    }

    throw new RuntimeRequestError("Unknown Pi event", 400);
  },

  encodeApprovalDecision(decision: ApprovalDecision, reason: string) {
    return {
      status: 200,
      body: { v: 1, decision: decision === "approve" ? "allow" : "deny", reason },
    };
  },
};
