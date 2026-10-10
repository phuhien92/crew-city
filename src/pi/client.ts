import { randomUUID } from "node:crypto";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

export interface PiBridgeOptions {
  baseUrl?: string;
  token?: string;
  taskId?: string;
  activityTimeoutMs?: number;
  approvalTimeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  id?: () => string;
}

export interface PiActivity {
  state: "session" | "thinking" | "tool" | "idle" | "approval";
  summary: string;
  toolName?: string;
  cwd?: string;
}

export interface PiApprovalRequest {
  toolCallId: string;
  cwd: string;
  tool: {
    name: string;
    input: Record<string, unknown>;
  };
}

export interface PiApprovalResult {
  decision: "allow" | "deny";
  reason: string;
}

/** Mirrors Pi's documented annotation policy for destructive, open-world, and uncertain tools. */
export function toolNeedsApproval(annotations: ToolAnnotations | undefined): boolean {
  return (
    annotations?.destructiveHint === true ||
    (!annotations?.readOnlyHint && ((annotations?.destructiveHint ?? true) || (annotations?.openWorldHint ?? true)))
  );
}

function loopbackBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (
      url.protocol !== "http:" ||
      !loopback ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export class PiBridgeClient {
  private readonly baseUrl: string | null;
  private readonly token: string | null;
  private readonly taskId: string | null;
  private readonly activityTimeoutMs: number;
  private readonly approvalTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(options: PiBridgeOptions = {}) {
    this.baseUrl = loopbackBaseUrl(options.baseUrl);
    this.token = options.token?.trim() || null;
    this.taskId = options.taskId?.trim() || null;
    this.activityTimeoutMs = options.activityTimeoutMs ?? 1_500;
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? 10 * 60_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): PiBridgeClient {
    const number = (value: string | undefined, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return new PiBridgeClient({
      baseUrl: env.CREW_CITY_URL,
      token: env.CREW_CITY_TOKEN,
      taskId: env.CREW_CITY_TASK_ID,
      activityTimeoutMs: number(env.CREW_CITY_ACTIVITY_TIMEOUT_MS, 1_500),
      approvalTimeoutMs: number(env.CREW_CITY_APPROVAL_TIMEOUT_MS, 10 * 60_000),
    });
  }

  get configurationError(): string | null {
    if (!this.baseUrl) return "CREW_CITY_URL must be an HTTP loopback URL";
    if (!this.token) return "CREW_CITY_TOKEN is missing";
    if (!this.taskId) return "CREW_CITY_TASK_ID is missing";
    return null;
  }

  async activity(activity: PiActivity): Promise<boolean> {
    if (this.configurationError) return false;
    try {
      const { response } = await this.post(
        {
          v: 1,
          event: "activity",
          eventId: this.id(),
          taskId: this.taskId,
          occurredAt: this.now(),
          cwd: activity.cwd,
          activity: {
            state: activity.state,
            summary: activity.summary.slice(0, 4_000),
            toolName: activity.toolName,
          },
        },
        this.activityTimeoutMs,
      );
      return response.status === 202;
    } catch {
      return false;
    }
  }

  async requestApproval(request: PiApprovalRequest, signal?: AbortSignal): Promise<PiApprovalResult> {
    const configurationError = this.configurationError;
    if (configurationError) return { decision: "deny", reason: configurationError };

    try {
      const { response, json: body } = await this.post(
        {
          v: 1,
          event: "approval.request",
          eventId: this.id(),
          taskId: this.taskId,
          occurredAt: this.now(),
          toolCallId: request.toolCallId,
          cwd: request.cwd,
          tool: request.tool,
        },
        this.approvalTimeoutMs,
        signal,
        true,
      );
      if (!body || typeof body !== "object") throw new Error("Malformed approval response");
      const result = body as Record<string, unknown>;
      if (response.status === 200 && result.v === 1 && result.decision === "allow") {
        return { decision: "allow", reason: typeof result.reason === "string" ? result.reason : "Approved" };
      }
      if (response.status === 200 && result.v === 1 && result.decision === "deny") {
        return { decision: "deny", reason: typeof result.reason === "string" ? result.reason : "Denied" };
      }
      throw new Error("Malformed approval response");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { decision: "deny", reason: `Crew City approval unavailable: ${message}` };
    }
  }

  private async post(
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    parseJson = false,
  ): Promise<{ response: Response; json?: unknown }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/runtime/pi/events`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (parseJson) return { response, json: (await response.json()) as unknown };
      await response.arrayBuffer();
      return { response };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
