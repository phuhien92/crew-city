import {
  RUNTIME_IDS,
  type ApprovalDecision,
  type RuntimeAdapter,
  type RuntimeAdapterDescriptor,
  type RuntimeId,
  RuntimeRequestError,
} from "./contract.js";
import { piAdapter } from "./pi.js";

const LABELS: Record<Exclude<RuntimeId, "pi">, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

function boundaryOnlyAdapter(id: Exclude<RuntimeId, "pi">): RuntimeAdapter {
  const reason = "Adapter boundary exists, but this runtime integration is not implemented";
  return {
    descriptor: {
      id,
      label: LABELS[id],
      implementation: "boundary-only",
      capabilities: {
        liveActivity: { supported: false, reason },
        approvals: { supported: false, mode: "unsupported", reason },
      },
    },
    parseEvent() {
      throw new RuntimeRequestError(`${LABELS[id]} events are not implemented`, 501);
    },
    encodeApprovalDecision(_decision: ApprovalDecision, _reason: string) {
      throw new RuntimeRequestError(`${LABELS[id]} approvals are not implemented`, 501);
    },
  };
}

const adapters = new Map<RuntimeId, RuntimeAdapter>([
  ["pi", piAdapter],
  ["claude-code", boundaryOnlyAdapter("claude-code")],
  ["codex", boundaryOnlyAdapter("codex")],
  ["opencode", boundaryOnlyAdapter("opencode")],
]);

export function getRuntimeAdapter(id: string): RuntimeAdapter | null {
  return RUNTIME_IDS.includes(id as RuntimeId) ? (adapters.get(id as RuntimeId) ?? null) : null;
}

export function runtimeAdapterDescriptors(): RuntimeAdapterDescriptor[] {
  return RUNTIME_IDS.map((id) => adapters.get(id)!.descriptor);
}
