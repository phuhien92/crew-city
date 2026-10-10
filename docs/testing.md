# Testing

Logic stays pure and is tested without a browser or GPU. The approval interaction also has one Chromium end-to-end test. Tests use recorded or made-up data, never live agents.

## What runs today

`npm test` (Vitest) and `npm run typecheck` run in CI on every push and pull request (Ubuntu with Node 22 and 24, macOS with Node 24). A separate Ubuntu/Node 24 job installs Chromium and runs `npm run test:e2e`:

| File | Covers |
| --- | --- |
| `test/ledger.test.ts` | Tailer: missing file, appended lines, partial lines, split UTF-8 characters, truncation |
| `test/city.test.ts` | Parser and reducer against firstmate's documented sample ledger and a busy-fleet fixture: unknown events, duplicates, status before dispatch, phase rules |
| `test/server.test.ts` | Real server on a free port: page and CSP header, 404s, WebSocket and runtime-event authentication/origin checks, ledger replay, Pi activity, malformed/duplicate/unsupported events, blocking approve and timeout-deny flows, audit output |
| `test/runtime-adapters.test.ts` | Adapter contract and capabilities, unsupported boundaries, Pi payload validation, activity ordering, duplicate/colliding events, duplicate blocking requests |
| `test/pi-client.test.ts` | Pi annotation policy, normalized/authenticated events, explicit decisions, loopback configuration, malformed-response and timeout fail-closed behavior |
| `test/ui.test.ts` | The real page in jsdom with a fake WebSocket: hostile ledger and runtime values render as text; one explicit approval decision is sent; only `https://` PR links become links; token is used and removed from the address bar |
| `e2e/pi-approval.spec.ts` | Chromium: Pi approval HTTP request blocks, the real card shows command/cwd, a real click approves it, the response unblocks, and the audit record is written |

The UI safety tests were checked by breaking the page on purpose (`innerHTML` for activity, linking any PR value): all 7 related tests failed, then passed again once restored.

## Layers planned

1. **Unit:** every pure module: placement algorithm, character variation, phase-to-color mapping, approval decisions, vault parser. The 3D scene gets a pure scene model (which lot, building style, colors, marker) tested without WebGL; the renderer only draws it.
2. **Fixtures from real formats:** firstmate ledgers; Pi adapter payloads; future runtime payloads only after their adapters are researched; a made-up COWORK OS vault (never the real one; the repo is public); replay snapshots of the city state.
3. **Server integration:** Pi approvals end to end (request in, explicit decision out), timeout denies, audit log written. Repeat this contract suite for each future implemented adapter.
4. **Fleet simulator:** demo mode grows into timed scenario scripts (busy morning, everything fails, 50 tasks, decision storm) for building and demoing without agents or tokens.
5. **UI:** React Testing Library for panel cards; Playwright end to end in a real browser; 3D screenshot comparison with a fixed seed, fixed clock, and animation paused.
6. **Real tools, by hand:** a real Pi session with the checked extension and a real firstmate home with the ledger flag. Future runtimes get a manual check only when their adapter is implemented. Each check closes an item in [open-questions.md](open-questions.md).
7. **Later:** frame rate with a generated 300-task ledger on a real machine (not CI: no GPU); Playwright Electron smoke test and packaging builds for the desktop app.

Never in CI: real agent-runtime model calls or firstmate runs.

## Browser end-to-end tests: when

Step 1 is already tested end to end without a browser: a real server on a real port, real ledger appends, and the real page loaded in jsdom. A real-browser Playwright suite adds the most where jsdom can't reach:

- **Step 2, approvals:** implemented in `e2e/pi-approval.spec.ts`: Pi adapter request in, approval card shown, real click, explicit reply out, and audit checked. This is the flow where a bug could approve the wrong command, so it runs in Chromium in CI on pull requests.
- **Step 4, the 3D city:** WebGL needs a real browser; screenshot comparison and click-to-select.
- **Step 6, desktop app:** Playwright's Electron support for a launch smoke test.

Playwright browsers install in CI with `npx playwright install --with-deps chromium`.
