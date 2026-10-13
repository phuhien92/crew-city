import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startServer, type RunningServer } from "../src/server/server.js";

const TOKEN = "playwright-token";
const RUNTIME_TOKEN = "playwright-runtime-token";
let server: RunningServer | undefined;

test.afterEach(async () => {
  await server?.close();
  server = undefined;
});

test("Pi tool call blocks until the browser approves it", async ({ page, request }) => {
  const dir = mkdtempSync(join(tmpdir(), "crew-city-e2e-"));
  const ledgerPath = join(dir, "fleet-ledger.jsonl");
  writeFileSync(ledgerPath, "");
  server = await startServer({
    ledgerPath,
    auditPath: join(dir, "approval-audit.jsonl"),
    port: 0,
    token: TOKEN,
    runtimeToken: RUNTIME_TOKEN,
    pollMs: 20,
  });

  await page.goto(`${server.url}/?token=${TOKEN}`);
  await expect(page.locator("#conn")).toHaveText("Live");

  const approvalResponse = request.post(`${server.url}/api/runtime/pi/events`, {
    headers: { authorization: `Bearer ${RUNTIME_TOKEN}` },
    data: {
      v: 1,
      event: "approval.request",
      eventId: "e2e-approval-1",
      taskId: "e2e-task",
      occurredAt: Date.now(),
      toolCallId: "call-1",
      cwd: "/tmp/e2e-project",
      tool: { name: "bash", input: { command: "rm -rf build" } },
    },
  });

  const card = page.locator(".approval");
  await expect(card).toContainText("rm -rf build");
  await expect(card).toContainText("/tmp/e2e-project");
  await card.getByRole("button", { name: "Approve bash for e2e-task" }).click();

  const response = await approvalResponse;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ v: 1, decision: "allow" });
  await expect(card).toHaveCount(0);
  expect(JSON.parse(readFileSync(server.auditPath, "utf8").trim())).toMatchObject({ decision: "approve", source: "user" });
});
