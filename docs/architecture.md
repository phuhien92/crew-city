# Architecture

Crew City is a local wrapper that shows a [firstmate](https://github.com/kunchenguid/firstmate) crew as a city and lets you act on what needs you. It reads from three sources and serves one browser UI.

```
City UI (browser)
   ▲  WebSocket, token-gated, 127.0.0.1 only
Wrapper server (Node)
   ├─ Ledger tailer   ← firstmate state/fleet-ledger.jsonl
   ├─ Hook endpoint   ← Claude Code hooks from crewmates
   ├─ Vault reader    ← COWORK OS (Obsidian vault)
   └─ Command relay   → first mate's tmux pane
```

Firstmate and the vault are never modified by the wrapper, except through the command relay, which only passes your own answers to the first mate.

## Status

| Piece | Status |
| --- | --- |
| Ledger tailer + city reducer + list UI | Done (step 1) |
| Hook endpoint (activity, approvals) | Not started (step 2) |
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
- Not in the ledger: whether a worker is idle or mid-turn, session IDs, worktree paths. Live activity comes from hooks (source 2).

Implementation: `src/server/ledger.ts` (parser and tailer), `src/server/city.ts` (reducer), `src/server/server.ts` (`startServer()`, used by the CLI entry `src/server/index.ts` and the tests).

- The tailer reads from a saved byte offset, holds back a partial last line, decodes UTF-8 across read boundaries, waits for a file that doesn't exist yet, and restarts from the top when the file shrinks.
- The reducer is pure. Restarting the server replays the ledger and rebuilds the city. History only covers tasks since the ledger was turned on.

### 2. Claude Code hooks (step 2)

Reference: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

- Hooks can be `http` handlers: Claude Code POSTs the event JSON to a URL and reads the decision from the response body.
- Every hook input includes `session_id`, `transcript_path`, `cwd`, and `hook_event_name`.
- `PermissionRequest` fires when a tool call needs approval. Input includes `tool_name` and `tool_input`. The hook can answer:

```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```

  with `"deny"` to refuse. `decision.updatedInput` can rewrite the tool input when allowing.
- Exit code 2 is not honored for `PermissionRequest`; denial must go through the `decision` object.
- Default timeout for `command` and `http` hooks is 600 seconds, set per hook with `timeout`. A timed-out hook returns no decision, and the call continues through the normal permission flow (the terminal prompt).
- `onFailure: "block"` (Claude Code v2.1.295 or later) makes a failed `PermissionRequest` hook deny the request.
- Hooks can live in `~/.claude/settings.json` (all projects) or a project's `.claude/settings.json`.

Planned use: an HTTP `PermissionRequest` hook pointing at the wrapper. The wrapper holds the request open, shows an approval card, and responds on Approve or Deny. Other hook events (`PreToolUse`, `PostToolUse`, `Stop`, `Notification`) feed each worker's activity line.

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
- **Control panel (left):** approval queue first (permission requests, then decisions), then one card per worker with task, project, kind, harness, phase, activity line, context usage, and PR link. Selecting a card selects and follows the character, and the reverse.
- **Top roster bar** with a status dot per worker; **bottom status line** with working, idle, and error counts; **voice bar** for the first mate (step 5).

## Security

The server can approve tool calls on your machine, so it is treated as sensitive from step 1.

- Binds to `127.0.0.1` by default.
- A random token is printed at startup. The WebSocket rejects a missing or wrong token (compared in constant time) and any foreign `Origin`. The page removes the token from the address bar after reading it.
- Content Security Policy on the page; data is rendered with `textContent`, never as HTML; only `https://` PR links are rendered as links.
- Approval rules (step 2):
  - Every card shows the full command and working directory.
  - No "approve all".
  - Every approval and denial goes to an audit log.
  - "Always allow" only for commands that don't change anything.
  - If no one answers, the request falls back to the terminal; it is never approved by default.
- Vault rules (step 3):
  - Agents read freely and write only to an HQ's Resources folder.
  - `MEMORY.md` is updated only by you or through the first mate, and holds facts only: no suggestions, predictions, or estimates; unknowns are written as unknown.
  - No git repositories or worktrees inside the iCloud vault.
  - Vault paths contain spaces and are always quoted.
