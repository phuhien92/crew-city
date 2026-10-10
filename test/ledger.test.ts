import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LedgerTailer, type LedgerEvent } from "../src/server/ledger.js";

const line = (task: string, ts = 1) => JSON.stringify({ v: 1, ts, event: "task.cleaned_up", task }) + "\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "crew-city-"));
  const path = join(dir, "fleet-ledger.jsonl");
  const seen: LedgerEvent[] = [];
  const tailer = new LedgerTailer(path, (e) => seen.push(e));
  return { path, seen, tailer };
}

describe("LedgerTailer", () => {
  it("waits quietly for a file that doesn't exist yet", async () => {
    const { path, seen, tailer } = setup();
    await tailer.readNew();
    expect(seen).toEqual([]);
    writeFileSync(path, line("a"));
    await tailer.readNew();
    expect(seen.map((e) => e.task)).toEqual(["a"]);
  });

  it("reads only appended lines and holds back a partial line", async () => {
    const { path, seen, tailer } = setup();
    writeFileSync(path, line("a"));
    await tailer.readNew();
    const next = line("b");
    appendFileSync(path, next.slice(0, 20));
    await tailer.readNew();
    expect(seen.map((e) => e.task)).toEqual(["a"]);
    appendFileSync(path, next.slice(20));
    await tailer.readNew();
    expect(seen.map((e) => e.task)).toEqual(["a", "b"]);
  });

  it("keeps a multi-byte character intact when a read splits it", async () => {
    const { path, seen, tailer } = setup();
    const full = Buffer.from(
      JSON.stringify({ v: 1, ts: 1, event: "task.status", task: "x", state: "working", key: null, text: "Phú Yên café" }) + "\n",
    );
    const cut = full.indexOf(Buffer.from("ú")) + 1; // inside the 2-byte sequence
    writeFileSync(path, full.subarray(0, cut));
    await tailer.readNew();
    appendFileSync(path, full.subarray(cut));
    await tailer.readNew();
    expect(seen[0]).toMatchObject({ text: "Phú Yên café" });
  });

  it("starts over after the file is truncated", async () => {
    const { path, seen, tailer } = setup();
    writeFileSync(path, line("a") + line("b"));
    await tailer.readNew();
    writeFileSync(path, ""); // `: > state/fleet-ledger.jsonl`
    await tailer.readNew();
    appendFileSync(path, line("c"));
    await tailer.readNew();
    expect(seen.map((e) => e.task)).toEqual(["a", "b", "c"]);
  });
});
