// Crew City command-line entry.
//
//   FM_HOME=~/firstmate npm start     follow a real firstmate home
//   npm run demo                       replay a scripted fleet into a temp ledger

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./server.js";
import { startDemo } from "./demo.js";

const demo = process.argv.includes("--demo");
const expand = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const ledgerPath = demo
  ? await startDemo()
  : resolve(expand(process.env.LEDGER ?? join(process.env.FM_HOME ?? "~/firstmate", "state/fleet-ledger.jsonl")));

const server = await startServer({
  ledgerPath,
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4317),
  token: process.env.CREW_CITY_TOKEN,
  auditPath: process.env.APPROVAL_AUDIT ? resolve(expand(process.env.APPROVAL_AUDIT)) : undefined,
  approvalTimeoutMs: process.env.APPROVAL_TIMEOUT_MS ? Number(process.env.APPROVAL_TIMEOUT_MS) : undefined,
});

console.log(`Crew City following ${ledgerPath}${demo ? " (demo)" : ""}`);
console.log(`Open ${server.url}/?token=${server.token}`);
console.log(`Approval audit: ${server.auditPath}`);
console.log("Keep that URL private: the token authorizes runtime events and approval decisions.");

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
