import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PiBridgeClient, toolNeedsApproval } from "../src/pi/client.ts";

/**
 * Crew City's Pi adapter.
 *
 * Configuration:
 *   CREW_CITY_URL=http://127.0.0.1:4317
 *   CREW_CITY_TOKEN=<the token printed by Crew City>
 *   CREW_CITY_TASK_ID=<the firstmate ledger task id>
 */
export default function crewCityExtension(pi: ExtensionAPI) {
  const bridge = PiBridgeClient.fromEnvironment();

  pi.on("session_start", async (event, ctx) => {
    await bridge.activity({ state: "session", summary: `Pi session ${event.reason}`, cwd: ctx.cwd });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await bridge.activity({ state: "thinking", summary: "Thinking", cwd: ctx.cwd });
  });

  pi.on("tool_call", async (event, ctx) => {
    const annotations = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
    if (!toolNeedsApproval(annotations)) return undefined;

    const result = await bridge.requestApproval(
      {
        toolCallId: event.toolCallId,
        cwd: ctx.cwd,
        tool: { name: event.toolName, input: event.input },
      },
      ctx.signal,
    );
    await bridge.activity({
      state: "approval",
      summary: `${result.decision === "allow" ? "Approved" : "Denied"}: ${event.toolName}`,
      toolName: event.toolName,
      cwd: ctx.cwd,
    });
    if (result.decision !== "allow") {
      return { block: true, reason: result.reason };
    }
    return undefined;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    await bridge.activity({ state: "tool", summary: `Using ${event.toolName}`, toolName: event.toolName, cwd: ctx.cwd });
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    await bridge.activity({
      state: "tool",
      summary: `${event.toolName} ${event.isError ? "failed" : "finished"}`,
      toolName: event.toolName,
      cwd: ctx.cwd,
    });
  });

  // agent_settled is Pi's final notification after retries, compaction, and queued work.
  pi.on("agent_settled", async (event, ctx) => {
    await bridge.activity({ state: "idle", summary: event.aborted ? "Turn aborted" : "Ready", cwd: ctx.cwd });
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await bridge.activity({ state: "session", summary: `Pi session ${event.reason}`, cwd: ctx.cwd });
  });
}
