// Loads the real page in jsdom with a fake WebSocket and feeds it hostile data.
// Ledger status text comes from workers and is untrusted: it must only ever show as text.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

const HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function loadPage(token: string | null = "t0k3n") {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    url: string;
    readyState = FakeSocket.OPEN;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    send(value: string) { this.sent.push(value); }
    close() {}
  }
  const dom = new JSDOM(HTML, {
    url: `http://127.0.0.1:4317/${token ? `?token=${token}` : ""}`,
    runScripts: "dangerously",
    beforeParse(window) {
      (window as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
    },
  });
  const deliver = (msg: unknown) => sockets[0]!.onmessage!({ data: JSON.stringify(msg) });
  return { dom, doc: dom.window.document, sockets, deliver };
}

const city = (tasks: Array<Record<string, unknown>>) => ({
  type: "city",
  ledgerPath: "/tmp/fleet-ledger.jsonl",
  stats: { population: 0, crew: tasks.length, fires: 0, needsYou: 0 },
  districts: {
    webapp: tasks.map((t) => ({
      id: "t", kind: "ship", project: "webapp", harness: "pi", model: null, phase: "working",
      activity: null, liveActivity: null, decisionKey: null, pr: null, workerPresent: true, dispatchedAt: 1, updatedAt: 1, ...t,
    })),
  },
  runtime: { adapters: [], activities: {}, approvals: [] as Array<Record<string, unknown>> },
});

describe("page: hostile data shows as text", () => {
  const attacks = [
    '<img src=x onerror="window.__pwned=1">',
    "<script>window.__pwned=1</script>",
    '"><svg onload="window.__pwned=1">',
  ];

  it.each(attacks)("activity text: %s", (payload) => {
    const { dom, doc, deliver } = loadPage();
    deliver(city([{ activity: payload }]));
    expect(doc.querySelector(".activity")!.textContent).toBe(payload);
    expect(doc.querySelectorAll("#city img, #city script, #city svg")).toHaveLength(0);
    expect((dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it.each(attacks)("task id, decision key, harness, and live activity: %s", (payload) => {
    const { dom, doc, deliver } = loadPage();
    deliver(city([{ id: payload, harness: payload, phase: "needs-decision", decisionKey: payload, activity: "?", liveActivity: { runtime: "pi", summary: payload } }]));
    expect(doc.querySelector(".name")!.textContent).toBe(payload);
    expect(doc.querySelector(".live-activity")!.textContent).toContain(payload);
    expect(doc.querySelectorAll("#city img, #city script, #city svg")).toHaveLength(0);
    expect((dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("district names", () => {
    const { doc, deliver } = loadPage();
    const msg = city([{}]);
    (msg.districts as Record<string, unknown>)['<img src=x onerror="1">'] = msg.districts.webapp;
    deliver(msg);
    expect(doc.querySelectorAll("#city img")).toHaveLength(0);
  });
});

describe("page: PR links", () => {
  it("links https PRs", () => {
    const { doc, deliver } = loadPage();
    deliver(city([{ pr: "https://github.com/acme/webapp/pull/7" }]));
    const a = doc.querySelector<HTMLAnchorElement>("#city a")!;
    expect(a.href).toBe("https://github.com/acme/webapp/pull/7");
    expect(a.textContent).toBe("acme/webapp/pull/7");
    expect(a.rel).toContain("noopener");
  });

  it.each(["javascript:alert(1)", "http://example.com/pr/1", "data:text/html,<b>x</b>", " https://evil.example"])(
    "does not link %s",
    (pr) => {
      const { doc, deliver } = loadPage();
      deliver(city([{ pr }]));
      expect(doc.querySelectorAll("#city a")).toHaveLength(0);
    },
  );
});

describe("page: approvals", () => {
  it("renders hostile runtime data as text and sends one explicit decision", () => {
    const attack = '<img src=x onerror="window.__pwned=1">';
    const { dom, doc, sockets, deliver } = loadPage();
    sockets[0]!.onopen!();
    const msg = city([{}]);
    msg.runtime.approvals = [{
      requestId: "request-1",
      runtime: attack,
      taskId: attack,
      requestedAt: 1,
      cwd: attack,
      tool: { name: "bash", input: { command: attack } },
    }];
    msg.stats.needsYou = 1;
    deliver(msg);

    expect(doc.getElementById("approvals")!.hidden).toBe(false);
    expect(doc.querySelector(".approval")!.textContent).toContain(attack);
    expect(doc.querySelectorAll("#approvals img, #approvals script, #approvals svg")).toHaveLength(0);
    expect((dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();

    const approve = doc.querySelector<HTMLButtonElement>("button.approve")!;
    const deny = doc.querySelector<HTMLButtonElement>("button.deny")!;
    approve.click();
    approve.click();
    expect(approve.disabled).toBe(true);
    expect(deny.disabled).toBe(true);
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: "approval.decision", requestId: "request-1", decision: "approve" });

    deliver({ type: "approval.error", requestId: "request-1", error: "Decision was not recorded" });
    const retry = doc.querySelector<HTMLButtonElement>("button.deny")!;
    expect(retry.disabled).toBe(false);
    retry.click();
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ type: "approval.decision", requestId: "request-1", decision: "deny" });
  });
});

describe("page: token handling", () => {
  it("connects with the token and removes it from the address bar", () => {
    const { dom, sockets } = loadPage("abc123");
    expect(sockets[0]!.url).toBe("ws://127.0.0.1:4317/ws?token=abc123");
    expect(dom.window.location.search).toBe("");
  });

  it("does not connect without a token", () => {
    const { doc, sockets } = loadPage(null);
    expect(sockets).toHaveLength(0);
    expect(doc.getElementById("conn")!.textContent).toContain("Missing token");
  });
});
