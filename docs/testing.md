# Testing

Logic stays pure and is tested without a browser or GPU. Tests use recorded or made-up data, never live agents.

## What runs today

`npm test` (Vitest), and in CI on every push and pull request (Ubuntu with Node 20 and 22, macOS with Node 22):

| File | Covers |
| --- | --- |
| `test/ledger.test.ts` | Tailer: missing file, appended lines, partial lines, split UTF-8 characters, truncation |
| `test/city.test.ts` | Parser and reducer against firstmate's documented sample ledger and a busy-fleet fixture: unknown events, duplicates, status before dispatch, phase rules |
| `test/server.test.ts` | Real server on a free port: page and CSP header, 404 for every other path, live feed rejects wrong or missing token and foreign origin, replay on connect, updates as the ledger grows |
| `test/ui.test.ts` | The real page in jsdom with a fake WebSocket: hostile text in activity, task ID, decision key, harness, and district names renders as text and runs nothing; only `https://` PR links become links; token is used and removed from the address bar |

The UI safety tests were checked by breaking the page on purpose (`innerHTML` for activity, linking any PR value): all 7 related tests failed, then passed again once restored.

## Layers planned

1. **Unit:** every pure module: placement algorithm, character variation, phase-to-color mapping, approval decisions, vault parser. The 3D scene gets a pure scene model (which lot, building style, colors, marker) tested without WebGL; the renderer only draws it.
2. **Fixtures from real formats:** firstmate ledgers; Claude Code hook payloads recorded once from a real session; a made-up COWORK OS vault (never the real one; the repo is public); replay snapshots of the city state.
3. **Server integration:** approvals end to end (recorded `PermissionRequest` in, click via test client, reply JSON out), timeout returns no decision, audit log written.
4. **Fleet simulator:** demo mode grows into timed scenario scripts (busy morning, everything fails, 50 tasks, decision storm) for building and demoing without agents or tokens.
5. **UI:** React Testing Library for panel cards; Playwright end to end in a real browser; 3D screenshot comparison with a fixed seed, fixed clock, and animation paused.
6. **Real tools, by hand:** a real Claude Code session with the hook pointed at the server; a real firstmate home with the ledger flag. Each check closes an item in [open-questions.md](open-questions.md).
7. **Later:** frame rate with a generated 300-task ledger on a real machine (not CI: no GPU); Playwright Electron smoke test and packaging builds for the desktop app.

Never in CI: real Claude Code or firstmate runs.

## Browser end-to-end tests: when

Step 1 is already tested end to end without a browser: a real server on a real port, real ledger appends, and the real page loaded in jsdom. A real-browser Playwright suite adds the most where jsdom can't reach:

- **Step 2, approvals (first):** hook request in, approval card shown, real click, correct reply out. This is the flow where a bug could approve the wrong command, so it gets a real-browser test as soon as it exists. Runs in CI on pull requests.
- **Step 4, the 3D city:** WebGL needs a real browser; screenshot comparison and click-to-select.
- **Step 6, desktop app:** Playwright's Electron support for a launch smoke test.

Playwright browsers install in CI with `npx playwright install --with-deps chromium`.
