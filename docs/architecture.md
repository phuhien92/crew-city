# Architecture

Crew City is a local wrapper that shows a [firstmate](https://github.com/kunchenguid/firstmate) crew as a city and lets you act on what needs you. It reads from three sources and serves one browser UI.

```
City UI (browser)
   ▲  WebSocket, token-gated, 127.0.0.1 only
Wrapper server (Node)
   ├─ Ledger tailer    ← firstmate state/fleet-ledger.jsonl
   ├─ Runtime adapters ← Pi extension (Claude Code/Codex/OpenCode boundaries only)
   ├─ Vault reader     ← COWORK OS (Obsidian vault)
   └─ Command relay    → first mate's tmux pane
```

Firstmate and the vault are never modified by the wrapper, except through the command relay, which only passes your own answers to the first mate.

## Status

| Piece | Status |
| --- | --- |
| Ledger tailer + city reducer + list UI | Done (step 1) |
| Runtime adapters (activity, approvals) | Pi implemented; Claude Code, Codex, and OpenCode boundary-only (step 2) |
| Vault reader | Not started (step 3) |
| 3D city renderer | Not started (step 4) |
| Command relay, voice | Not started (step 5) |
| Desktop app | Not started (step 6); see [tech-research.md](tech-research.md) |

## Sources

### 1. Firstmate fleet ledger

Contract: [firstmate docs/fleet-ledger.md](https://github.com/kunchenguid/firstmate/blob/main/docs/fleet-ledger.md).

- Turned on by creating the flag file `config/fleet-ledger` in a firstmate home. Each home (including second mate homes) needs its own flag.
- File: `state/fleet-ledger.jsonl`, append-only JSON Lines. Every record has `v`, `ts` (Unix seconds), `event`, `task`.
- Events:

| Event | Extra members |
| --- | --- |
| `task.dispatched` | `kind` (`ship`, `scout`, `secondmate`), `project` (null for a remote second mate), `harness`, `model` |
| `task.status` | `state` (`working`, `needs-decision`, `blocked`, `paused`, `done`, `failed`, `resolved`, or null), `key` (decision key or null), `text` |
| `task.pr_ready` | `pr` (full URL) |
| `task.merged` | `via` (`pr` or `local`), plus `pr` when via is `pr` |
| `task.cleaned_up` | none |

- Contract rules the reader follows: ignore unknown events and members; tolerate duplicate records (delivery is at least once); a status record can arrive before its `task.dispatched`; no sequence numbers; the file is never rotated but can be truncated with `: > state/fleet-ledger.jsonl`.
- Not in the ledger: whether a worker is idle or mid-turn, session IDs, worktree paths. Ephemeral live activity comes from runtime adapters (source 2).

Implementation: `src/server/ledger.ts` (parser and tailer), `src/server/city.ts` (reducer), `src/server/server.ts` (`startServer()`, used by the CLI entry `src/server/index.ts` and the tests).

- The tailer reads from a saved byte offset, holds back a partial last line, decodes UTF-8 across read boundaries, waits for a file that doesn't exist yet, and restarts from the top when the file shrinks.
- The reducer is pure. Restarting the server replays the ledger and rebuilds the city. History only covers tasks since the ledger was turned on.

### 2. Runtime adapters (step 2)

The adapter contract in `src/server/runtime/contract.ts` normalizes two ephemeral concerns only:

- latest live activity for a ledger task;
- a blocking approval request and its explicit allow/deny result.

It does not replace or write to firstmate's ledger. Dispatch, status, PR, merge, and cleanup remain durable ledger events. Runtime events carry an explicit ledger task id and are de-duplicated by `(runtime, eventId)`; malformed events are rejected, exact duplicates are idempotent, and event-id collisions return a conflict.

| Adapter | Live activity | Blocking approvals | Status |
| --- | --- | --- | --- |
| Pi | Supported | Supported | Implemented |
| Claude Code | Unsupported | Unsupported | Named boundary only |
| Codex | Unsupported | Unsupported | Named boundary only |
| OpenCode | Unsupported | Unsupported | Named boundary only |

“Unsupported” describes Crew City's current adapter, not a claim about what the runtime could support in a future integration.

#### Pi

Reference: the installed Pi 1.1.0 extension documentation and its permission-gate examples.

`extensions/crew-city.ts` uses supported Pi extension APIs:

- `session_start`, `before_agent_start`, `tool_execution_start`, `tool_execution_end`, `agent_settled`, and `session_shutdown` publish best-effort activity;
- an asynchronous `tool_call` handler inspects `pi.getAllTools()` annotations and waits for Crew City's response;
- a deny response returns `{ block: true, reason }`. Pi documents handler failure as fail-safe blocking too.

Pi does not expose a Claude Code `PermissionRequest` hook. Crew City therefore implements blocking approval as extension policy at Pi's pre-execution `tool_call` boundary. Calls marked read-only continue without a card. Destructive tools and non-read-only tools whose destructive/open-world behavior is not explicitly false block until an explicit response. The bridge also blocks on missing configuration, a non-loopback endpoint, network failure, timeout, or malformed response.

The extension posts bearer-token-protected JSON to `POST /api/runtime/pi/events`. An approval POST stays open while the card is pending. The authenticated browser sends the decision over its existing WebSocket. Timeouts deny. Decisions are appended to Crew City's own approval audit JSONL before an allow response is released.

### 3. COWORK OS vault (step 3)

- An Obsidian vault in iCloud, organized into HQ folders.
- Each HQ has `CLAUDE.md` (behavioral rules and a resource routing table), `MEMORY.md` (facts and active tasks), and a Resources subfolder of notes.
- The vault path is configuration, not code. It must not be committed.

Planned use: each HQ becomes a district; its active tasks feed that district's board. Read-only in the first version.

### 4. Command relay (step 5)

- The first mate is the only agent you talk to in firstmate's design, and it holds merge authority and tracks decisions by key.
- Planned: Merge and decision answers from the UI are sent to the first mate's session, by default with `tmux send-keys` into its pane. Workers are never messaged directly.

## UI

- **City view:** one district per project (and later per HQ). Each task is a lot: breaking ground → scaffolding → City Hall alert / fire → inspection → finished building. A finished building stays after its worker leaves.
- **Control panel (left):** approval queue first (runtime tool requests, then decisions), then one card per worker with task, project, kind, harness, phase, activity line, context usage, and PR link. Selecting a card selects and follows the character, and the reverse.
- **Top roster bar** with a status dot per worker; **bottom status line** with working, idle, and error counts; **voice bar** for the first mate (step 5).

## Security

The server can approve tool calls on your machine, so it is treated as sensitive from step 1.

- Binds only to loopback (`127.0.0.1` by default; `::1` is also accepted).
- A random token is printed at startup. The WebSocket rejects a missing or wrong token (compared in constant time) and any foreign `Origin`. Runtime HTTP events require the same token as a bearer credential and reject foreign origins. The page removes the token from the address bar after reading it.
- The server binds to loopback by default, and the Pi bridge refuses non-loopback URLs so its bearer token is not sent remotely.
- Content Security Policy on the page; data is rendered with `textContent`, never as HTML; only `https://` PR links are rendered as links.
- Approval rules (step 2):
  - Every card shows the full tool input and working directory, including the full command for `bash`.
  - No "approve all" or persistent allow rule.
  - Every explicit approval and denial is appended to a mode-`0600` audit log; its default path is outside the firstmate home.
  - No answer, unavailable server, incomplete configuration, malformed response, or timeout denies the Pi tool call. It is never approved by default.
- Vault rules (step 3):
  - Agents read freely and write only to an HQ's Resources folder.
  - `MEMORY.md` is updated only by you or through the first mate, and holds facts only: no suggestions, predictions, or estimates; unknowns are written as unknown.
  - No git repositories or worktrees inside the iCloud vault.
  - Vault paths contain spaces and are always quoted.
