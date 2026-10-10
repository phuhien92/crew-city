# Open questions

Things not yet verified. Each one notes what is known, what is unknown, and where to look. Move an item to `architecture.md` or `decisions.md` once it is settled.

## Linking a task to its Claude session

- **Known:** Ledger records carry a `task` id but no session id or worktree path. Every Claude Code hook input carries `session_id` and `cwd`.
- **Unknown:** How firstmate names a task's worktree directory (via [treehouse](https://github.com/kunchenguid/treehouse)), and whether the task id appears in that path.
- **Check:** firstmate's `bin/` scripts and `docs/architecture.md`; treehouse's worktree naming.

## Crewmate permission mode

- **Known:** The approval queue depends on `PermissionRequest` hooks firing in crewmate sessions.
- **Unknown:** Whether firstmate launches Claude Code crewmates with permissions bypassed. If it does, no permission requests fire, and approvals would mostly be decisions and merges.
- **Check:** How firstmate starts crewmate sessions (`bin/` scripts, dispatch profiles in `docs/configuration.md`).

## Terminal prompt while a hook is waiting

- **Known:** A `PermissionRequest` hook that times out returns no decision, and the normal permission flow continues.
- **Unknown:** Whether Claude Code shows its own terminal prompt while the hook is still waiting, or only after.
- **Check:** Test with a hook that sleeps.

## "Always allow" from the UI

- **Known:** The hooks docs say a `PermissionRequest` hook can apply permission rules so the user isn't prompted again.
- **Unknown:** The exact output field for that.
- **Check:** "PermissionRequest decision control" in the [hooks reference](https://code.claude.com/docs/en/hooks).

## Supported input channel into the first mate

- **Known:** Firstmate has Relay (X and Discord mentions) and a voice relay (`docs/voice-relay.md`). `tmux send-keys` into the first mate's pane works with any harness.
- **Unknown:** Whether firstmate offers a supported local channel for sending captain messages that is more robust than keystrokes.
- **Check:** firstmate `docs/configuration.md`, `docs/voice-relay.md`, `AGENTS.md`.

## Hooks coexisting

- **Known:** Firstmate tracks its own hooks in the repo (for example a Claude Code Stop hook for the primary session). Claude Code merges hooks across settings levels and runs all matching hooks in parallel.
- **Unknown:** Whether a user-level Crew City hook and firstmate's project hooks interfere in practice.
- **Check:** Run both and inspect `/hooks` in a crewmate session.

## Ledger tailer: truncate-then-refill

- **Known:** The tailer detects truncation when the file becomes smaller than its saved offset.
- **Unknown:** Not handled: if the file is truncated and then grows past the old offset before the next read (default poll is 1 second), the tailer would read from the old offset and miss records.
- **Check:** Whether this happens in practice; a fix would compare the file's inode or first bytes between reads.

## Vault contents

- **Known:** HQ folders each hold `CLAUDE.md`, `MEMORY.md`, and a Resources folder.
- **Unknown:** The full list of HQs and whether every HQ follows the same layout and active-task format.
- **Check:** Run the `cowork-os-audit` skill, or list the vault before writing the reader.
