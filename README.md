# Crew City

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

Requires Node 20+.

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
npm test          # reducer + tailer tests, using firstmate's documented sample ledger
npm run typecheck
npm run dev       # restart on change
```

## Roadmap

1. Ledger tailer + list UI ✅
2. Hook endpoint: live activity and Approve/Deny via Claude Code's `PermissionRequest` hook
3. Vault reader: COWORK OS HQs as districts (read-only)
4. 3D isometric city with react-three-fiber
5. Command relay (merge, decisions) and voice
