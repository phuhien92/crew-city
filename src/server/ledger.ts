// Reads firstmate's fleet ledger (state/fleet-ledger.jsonl).
// Contract: docs/fleet-ledger.md in the firstmate repo. Readers must ignore
// unknown members and events, and tolerate duplicate records.

import { open, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export type LedgerEvent =
  | { event: "task.dispatched"; ts: number; task: string; kind: string; project: string | null; harness: string; model: string | null }
  | { event: "task.status"; ts: number; task: string; state: string | null; key: string | null; text: string }
  | { event: "task.pr_ready"; ts: number; task: string; pr: string }
  | { event: "task.merged"; ts: number; task: string; via: "pr" | "local"; pr?: string }
  | { event: "task.cleaned_up"; ts: number; task: string };

const KNOWN = new Set(["task.dispatched", "task.status", "task.pr_ready", "task.merged", "task.cleaned_up"]);

/** Parse one ledger line. Returns null for blank, malformed, or unrecognized records. */
export function parseLedgerLine(line: string): LedgerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.event !== "string" || !KNOWN.has(r.event)) return null;
  if (typeof r.task !== "string" || typeof r.ts !== "number") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  switch (r.event) {
    case "task.dispatched":
      return { event: r.event, ts: r.ts, task: r.task, kind: str(r.kind) ?? "ship", project: str(r.project), harness: str(r.harness) ?? "unknown", model: str(r.model) };
    case "task.status":
      return { event: r.event, ts: r.ts, task: r.task, state: str(r.state), key: str(r.key), text: (str(r.text) ?? "").trim() };
    case "task.pr_ready":
      return str(r.pr) ? { event: r.event, ts: r.ts, task: r.task, pr: r.pr as string } : null;
    case "task.merged":
      return { event: r.event, ts: r.ts, task: r.task, via: r.via === "local" ? "local" : "pr", ...(str(r.pr) ? { pr: r.pr as string } : {}) };
    case "task.cleaned_up":
      return { event: r.event, ts: r.ts, task: r.task };
  }
  return null;
}

/**
 * Follows the ledger file from a byte offset, emitting complete lines only.
 * Handles the file not existing yet, partial trailing lines, and truncation
 * (`: > state/fleet-ledger.jsonl`), which restarts reading from the top.
 */
export class LedgerTailer {
  private offset = 0;
  private partial = "";
  private decoder = new StringDecoder("utf8");
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reading = false;
  private again = false;

  constructor(
    private readonly path: string,
    private readonly onEvent: (e: LedgerEvent) => void,
    private readonly pollMs = 1000,
  ) {}

  /** Read everything currently in the file, then keep following it. */
  async start(): Promise<void> {
    await this.readNew();
    try {
      this.watcher = watch(this.path, () => void this.readNew());
    } catch {
      // File may not exist yet; polling picks it up once it does.
    }
    this.timer = setInterval(() => void this.readNew(), this.pollMs);
  }

  stop(): void {
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
    this.watcher = null;
    this.timer = null;
  }

  /** Exposed for tests: read any bytes appended since the last read. */
  async readNew(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.again = false;
        await this.readOnce();
      } while (this.again);
    } finally {
      this.reading = false;
    }
  }

  private async readOnce(): Promise<void> {
    let size: number;
    try {
      size = (await stat(this.path)).size;
    } catch {
      return; // not there yet
    }
    if (size < this.offset) {
      // Truncated: start over.
      this.offset = 0;
      this.partial = "";
      this.decoder = new StringDecoder("utf8");
    }
    if (size === this.offset) return;

    const fh = await open(this.path, "r");
    try {
      const buf = Buffer.alloc(size - this.offset);
      const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
      this.offset += bytesRead;
      // StringDecoder holds back a multi-byte character split across reads.
      const text = this.partial + this.decoder.write(buf.subarray(0, bytesRead));
      const lines = text.split("\n");
      this.partial = lines.pop() ?? "";
      for (const line of lines) {
        const ev = parseLedgerLine(line);
        if (ev) this.onEvent(ev);
      }
    } finally {
      await fh.close();
    }
  }
}
