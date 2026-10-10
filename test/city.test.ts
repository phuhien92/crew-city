import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLedgerLine, type LedgerEvent } from "../src/server/ledger.js";
import { applyEvent, buildCity, cityStats, districts, emptyCity } from "../src/server/city.js";

const load = (name: string): LedgerEvent[] =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
    .split("\n")
    .map(parseLedgerLine)
    .filter((e): e is LedgerEvent => e !== null);

describe("parseLedgerLine", () => {
  it("ignores blank, malformed, and unknown records", () => {
    expect(parseLedgerLine("")).toBeNull();
    expect(parseLedgerLine("not json")).toBeNull();
    expect(parseLedgerLine('{"v":1,"ts":1,"event":"task.future","task":"x"}')).toBeNull();
    expect(parseLedgerLine('{"v":1,"event":"task.cleaned_up","task":"x"}')).toBeNull(); // no ts
  });

  it("ignores unknown members on known events", () => {
    const e = parseLedgerLine('{"v":2,"ts":5,"event":"task.cleaned_up","task":"x","extra":true}');
    expect(e).toEqual({ event: "task.cleaned_up", ts: 5, task: "x" });
  });

  it("trims the leading space firstmate keeps after the colon", () => {
    const e = parseLedgerLine('{"v":1,"ts":1,"event":"task.status","task":"x","state":"working","key":null,"text":" bug reproduced"}');
    expect(e).toMatchObject({ state: "working", text: "bug reproduced" });
  });
});

describe("city reducer: firstmate docs sample", () => {
  const city = buildCity(load("docs-sample.jsonl"));
  const t = city.tasks["fix-login"]!;

  it("walks a ship task from dispatch to a finished building", () => {
    expect(t.phase).toBe("merged");
    expect(t.project).toBe("webapp");
    expect(t.pr).toBe("https://github.com/acme/webapp/pull/7");
  });

  it("keeps the building after the worker leaves", () => {
    expect(t.workerPresent).toBe(false);
    expect(cityStats(city)).toEqual({ population: 1, crew: 0, fires: 0, needsYou: 0 });
  });
});

describe("city reducer: busy fleet", () => {
  const city = buildCity(load("busy-fleet.jsonl"));

  it("handles a status line that arrives before its dispatch record", () => {
    const t = city.tasks["auth-audit"]!;
    expect(t.kind).toBe("scout");
    expect(t.project).toBe("api");
    expect(t.phase).toBe("working");
    expect(t.activity).toBe("reading session.ts");
  });

  it("raises a decision with its key", () => {
    const t = city.tasks["dark-mode"]!;
    expect(t.phase).toBe("needs-decision");
    expect(t.decisionKey).toBe("theme");
  });

  it("tolerates duplicate records", () => {
    expect(cityStats(city)).toEqual({ population: 0, crew: 4, fires: 1, needsYou: 1 });
  });

  it("groups tasks into districts, with remote secondmates on their own", () => {
    const d = districts(city);
    expect(Object.keys(d).sort()).toEqual(["(remote)", "api", "webapp"]);
    expect(d.api!.map((t) => t.id)).toEqual(["auth-audit", "rate-limit"]);
  });
});

describe("phase rules", () => {
  const ev = (e: Partial<LedgerEvent> & { event: LedgerEvent["event"] }) =>
    ({ ts: 1, task: "t", ...e }) as LedgerEvent;

  it("never un-merges a building", () => {
    const city = emptyCity();
    applyEvent(city, ev({ event: "task.merged", via: "local" }));
    applyEvent(city, ev({ event: "task.status", state: "failed", key: null, text: "late line" }));
    expect(city.tasks.t!.phase).toBe("merged");
    expect(city.tasks.t!.activity).toBe("late line");
  });

  it("keeps pr-ready when a plain working line follows", () => {
    const city = emptyCity();
    applyEvent(city, ev({ event: "task.pr_ready", pr: "https://x/pr/1" }));
    applyEvent(city, ev({ event: "task.status", state: "working", key: null, text: "addressing review" }));
    expect(city.tasks.t!.phase).toBe("pr-ready");
  });

  it("clears the decision once resolved", () => {
    const city = emptyCity();
    applyEvent(city, ev({ event: "task.status", state: "needs-decision", key: "k", text: "?" }));
    applyEvent(city, ev({ event: "task.status", state: "resolved", key: null, text: "answered" }));
    expect(city.tasks.t!.phase).toBe("working");
    expect(city.tasks.t!.decisionKey).toBeNull();
  });
});
