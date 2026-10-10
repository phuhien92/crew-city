// Turns ledger events into the city's state: districts (projects) holding lots (tasks).
// Pure and deterministic, so replaying the ledger from the top rebuilds the city.

import type { LedgerEvent } from "./ledger.js";

/** Where a task's lot is in its life. Merged is final; later status lines can't undo it. */
export type Phase =
  | "dispatched" // ground broken, worker walking over
  | "working" // scaffolding up
  | "needs-decision" // City Hall alert
  | "blocked"
  | "paused"
  | "failed" // fire
  | "done" // worker reports done, waiting on PR
  | "pr-ready" // inspection
  | "merged"; // finished building

export interface Task {
  id: string;
  kind: string; // ship | scout | secondmate
  project: string | null;
  harness: string;
  model: string | null;
  phase: Phase;
  /** Latest status line text, verbatim from the worker. */
  activity: string | null;
  /** Decision key when phase is needs-decision. */
  decisionKey: string | null;
  pr: string | null;
  /** False once firstmate cleans the task up: the worker leaves town, the lot stays. */
  workerPresent: boolean;
  dispatchedAt: number | null;
  updatedAt: number;
}

export interface CityState {
  tasks: Record<string, Task>;
}

export const emptyCity = (): CityState => ({ tasks: {} });

const STATE_TO_PHASE: Record<string, Phase> = {
  working: "working",
  "needs-decision": "needs-decision",
  blocked: "blocked",
  paused: "paused",
  failed: "failed",
  done: "done",
  // "resolved" means a decision or blocker was cleared: back to work.
  resolved: "working",
};

function ensureTask(city: CityState, id: string, ts: number): Task {
  const existing = city.tasks[id];
  if (existing) return existing;
  // A status line can arrive just before its task.dispatched record.
  const t: Task = {
    id,
    kind: "ship",
    project: null,
    harness: "unknown",
    model: null,
    phase: "dispatched",
    activity: null,
    decisionKey: null,
    pr: null,
    workerPresent: true,
    dispatchedAt: null,
    updatedAt: ts,
  };
  city.tasks[id] = t;
  return t;
}

/** Applies one event in place and returns the same state object. */
export function applyEvent(city: CityState, e: LedgerEvent): CityState {
  const t = ensureTask(city, e.task, e.ts);
  t.updatedAt = Math.max(t.updatedAt, e.ts);

  switch (e.event) {
    case "task.dispatched":
      t.kind = e.kind;
      t.project = e.project;
      t.harness = e.harness;
      t.model = e.model;
      t.dispatchedAt ??= e.ts;
      break;

    case "task.status": {
      t.activity = e.text || t.activity;
      if (t.phase === "merged") break;
      const next = e.state ? STATE_TO_PHASE[e.state] : undefined;
      if (next) {
        // Once a PR is up, a plain "working" or "done" line doesn't knock it back.
        if (t.phase === "pr-ready" && (next === "working" || next === "done")) break;
        t.phase = next;
        t.decisionKey = next === "needs-decision" ? e.key : null;
      } else if (t.phase === "dispatched") {
        t.phase = "working";
      }
      break;
    }

    case "task.pr_ready":
      t.pr = e.pr;
      if (t.phase !== "merged") t.phase = "pr-ready";
      t.decisionKey = null;
      break;

    case "task.merged":
      t.phase = "merged";
      if (e.pr) t.pr = e.pr;
      t.decisionKey = null;
      break;

    case "task.cleaned_up":
      t.workerPresent = false;
      break;
  }
  return city;
}

export function buildCity(events: Iterable<LedgerEvent>): CityState {
  const city = emptyCity();
  for (const e of events) applyEvent(city, e);
  return city;
}

export interface CityStats {
  population: number; // merged tasks
  crew: number; // workers still in town
  fires: number;
  needsYou: number;
}

export function cityStats(city: CityState): CityStats {
  const tasks = Object.values(city.tasks);
  return {
    population: tasks.filter((t) => t.phase === "merged").length,
    crew: tasks.filter((t) => t.workerPresent).length,
    fires: tasks.filter((t) => t.phase === "failed" && t.workerPresent).length,
    needsYou: tasks.filter((t) => t.phase === "needs-decision" && t.workerPresent).length,
  };
}

/** Tasks grouped by district (project). Remote secondmates have no project. */
export function districts(city: CityState): Record<string, Task[]> {
  const out: Record<string, Task[]> = {};
  for (const t of Object.values(city.tasks)) {
    const key = t.project ?? "(remote)";
    (out[key] ??= []).push(t);
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.dispatchedAt ?? a.updatedAt) - (b.dispatchedAt ?? b.updatedAt));
  return out;
}
