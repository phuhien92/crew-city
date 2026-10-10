<p align="center">
  <img src="assets/brand/mark.svg" width="160" alt="Crew City logo: three block towers, the tallest wearing a hard hat">
</p>

<h1 align="center">Crew City</h1>

<p align="center"><b>Your agent crew, as a city</b></p>

<p align="center"><a href="https://github.com/phuhien92/crew-city/actions/workflows/ci.yml"><img src="https://github.com/phuhien92/crew-city/actions/workflows/ci.yml/badge.svg" alt="CI status"></a></p>

A SimCity-style view of a [firstmate](https://github.com/kunchenguid/firstmate) crew, with COWORK OS as the knowledge layer.

Firstmate and the vault stay untouched. Crew City only reads from them, apart from one narrow command path (coming in step 5).

```
City UI  (browser)
   ▲  WebSocket, token-gated, 127.0.0.1 only
Wrapper server
   ├─ Ledger tailer   ← firstmate state/fleet-ledger.jsonl     (step 1, done)
   ├─ Hook endpoint   ← Claude Code hooks, approvals            (step 2)
   ├─ Vault reader    ← COWORK OS HQs → districts, read-only    (step 3)
   └─ Command relay   → first mate's tmux pane                  (step 5)
```

## Run it

Requires Node 22 or later.

```sh
npm install
npm run demo                      # scripted fleet, no firstmate needed
FM_HOME=~/firstmate npm start     # follow a real firstmate home
```

Open the URL the server prints. It carries a `?token=`; keep it private, because the same token will authorize approvals later.

To have firstmate write the ledger, create the flag file in its home:

```sh
touch ~/firstmate/config/fleet-ledger
```

Settings (environment variables): `FM_HOME`, `LEDGER` (overrides the ledger path), `PORT` (default 4317), `HOST` (default 127.0.0.1), `CREW_CITY_TOKEN` (fixed token instead of a random one).

## How a task maps to the city

| Ledger | City |
| --- | --- |
| `task.dispatched` | Lot breaks ground in the project's district |
| `task.status` working | Scaffolding up |
| `task.status` needs-decision | City Hall alert, with the decision key |
| `task.status` failed | Fire |
| `task.pr_ready` | Inspection |
| `task.merged` | Finished building (permanent) |
| `task.cleaned_up` | Worker leaves town; the building stays |

The reducer in `src/server/city.ts` is pure, so restarting the server replays the ledger and rebuilds the whole city. It follows the ledger contract: unknown events and members are ignored, duplicates are harmless, and a status line arriving before its dispatch record is handled.

## Develop

```sh
npm test          # all tests: tailer, reducer, server, and page safety
npm run typecheck
npm run dev       # restart on change
```

Tests use recorded or made-up data, never live agents. CI runs typecheck and tests on every push and pull request (Ubuntu with Node 22 and 24, macOS with Node 24). What each test covers, and the testing plan: [docs/testing.md](docs/testing.md).

Code layout:

| Path | What |
| --- | --- |
| `src/server/ledger.ts` | Ledger parser and tailer |
| `src/server/city.ts` | Pure reducer: ledger events to city state |
| `src/server/server.ts` | `startServer()`: HTTP page, token-gated WebSocket feed |
| `src/server/index.ts` | Command-line entry |
| `src/server/demo.ts` | Scripted fleet for `npm run demo` |
| `public/index.html` | Step 1 list UI |
| `test/` | Vitest tests and fixtures |

## Docs

- [Architecture](docs/architecture.md): sources, data flow, UI plan, security rules
- [Decisions](docs/decisions.md): what was chosen, why, and what else was considered
- [Open questions](docs/open-questions.md): unknowns still to verify
- [Tech research: desktop app](docs/tech-research.md): Electron vs Tauri and what it means for the code
- [Visual style](docs/visual-style.md): character design and colors
- [Map and landscaping](docs/map.md): city layout, growth, landscaping, camera
- [Testing](docs/testing.md): what the tests cover and the testing plan

## Roadmap

1. Ledger tailer + list UI ✅
2. Hook endpoint: live activity and Approve/Deny via Claude Code's `PermissionRequest` hook
3. Vault reader: COWORK OS HQs as districts (read-only)
4. 3D isometric city with react-three-fiber
5. Command relay (merge, decisions) and voice
6. Desktop app (Electron proposed; see the tech research)
