// Writes a scripted fleet into a temp ledger, one record every couple of seconds,
// so the city can be watched without a running firstmate.

import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Rec = Record<string, unknown> & { event: string; task: string };

const SCRIPT: Rec[] = [
  { event: "task.dispatched", task: "fix-login", kind: "ship", project: "webapp", harness: "claude", model: null },
  { event: "task.dispatched", task: "auth-audit", kind: "scout", project: "api", harness: "claude", model: null },
  { event: "task.status", task: "fix-login", state: "working", key: null, text: " bug reproduced" },
  { event: "task.dispatched", task: "dark-mode", kind: "ship", project: "webapp", harness: "claude", model: "opus" },
  { event: "task.status", task: "auth-audit", state: "working", key: null, text: " reading session.ts" },
  { event: "task.dispatched", task: "rate-limit", kind: "ship", project: "api", harness: "codex", model: null },
  { event: "task.status", task: "dark-mode", state: "needs-decision", key: "theme", text: " CSS variables or Tailwind dark: classes?" },
  { event: "task.status", task: "rate-limit", state: "working", key: null, text: " adding token bucket" },
  { event: "task.status", task: "fix-login", state: "done", key: null, text: " PR https://github.com/acme/webapp/pull/7 checks green" },
  { event: "task.pr_ready", task: "fix-login", pr: "https://github.com/acme/webapp/pull/7" },
  { event: "task.status", task: "rate-limit", state: "failed", key: null, text: " 3 tests failing" },
  { event: "task.status", task: "dark-mode", state: "resolved", key: null, text: " using CSS variables" },
  { event: "task.merged", task: "fix-login", via: "pr", pr: "https://github.com/acme/webapp/pull/7" },
  { event: "task.status", task: "auth-audit", state: "done", key: null, text: " report at data/auth-audit/report.md" },
  { event: "task.cleaned_up", task: "fix-login" },
  { event: "task.cleaned_up", task: "auth-audit" },
];

export async function startDemo(stepMs = 2000): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "crew-city-demo-")), "fleet-ledger.jsonl");
  writeFileSync(path, "");
  let i = 0;
  const timer = setInterval(() => {
    const rec = SCRIPT[i++];
    if (!rec) return clearInterval(timer);
    appendFileSync(path, JSON.stringify({ v: 1, ts: Math.floor(Date.now() / 1000), ...rec }) + "\n");
  }, stepMs);
  timer.unref();
  return path;
}
