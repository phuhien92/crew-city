# Open questions

Things not yet verified. Each one notes what is known, what is unknown, and where to look. Move an item to `architecture.md` or `decisions.md` once it is settled.

## Automatic Pi task configuration

- **Known:** The Pi adapter links ephemeral events to durable lifecycle state through the explicit `CREW_CITY_TASK_ID` value. `CREW_CITY_URL` and `CREW_CITY_TOKEN` are explicit too; the adapter does not guess from a worktree path or session.
- **Unknown:** How a future firstmate dispatch profile should inject these values and load `extensions/crew-city.ts` automatically without putting the token in committed settings.
- **Check:** firstmate dispatch profiles and environment configuration before adding automatic setup.

## Future Claude Code adapter

- **Known:** Claude Code, Codex, and OpenCode are boundary-only adapters today. Crew City makes no capability claim for them. Earlier research found a Claude Code `PermissionRequest` HTTP hook, but it is not implemented or tested here.
- **Unknown:** Whether firstmate's Claude Code launch mode emits permission requests, how its terminal prompt behaves while an HTTP hook waits, and how Crew City hooks coexist with firstmate's own hooks.
- **Check:** Re-read the then-current primary runtime documentation and test fail-closed behavior before changing any capability declaration.

## Supported input channel into the first mate

- **Known:** Firstmate has Relay (X and Discord mentions) and a voice relay (`docs/voice-relay.md`). `tmux send-keys` into the first mate's pane works with any harness.
- **Unknown:** Whether firstmate offers a supported local channel for sending captain messages that is more robust than keystrokes.
- **Check:** firstmate `docs/configuration.md`, `docs/voice-relay.md`, `AGENTS.md`.

## Ledger tailer: truncate-then-refill

- **Known:** The tailer detects truncation when the file becomes smaller than its saved offset.
- **Unknown:** Not handled: if the file is truncated and then grows past the old offset before the next read (default poll is 1 second), the tailer would read from the old offset and miss records.
- **Check:** Whether this happens in practice; a fix would compare the file's inode or first bytes between reads.

## Vault contents

- **Known:** HQ folders each hold `CLAUDE.md`, `MEMORY.md`, and a Resources folder.
- **Unknown:** The full list of HQs and whether every HQ follows the same layout and active-task format.
- **Check:** Run the `cowork-os-audit` skill, or list the vault before writing the reader.

## District layout file

- **Known:** District placement must stay stable, and HQ districts don't come from the ledger, so placements are saved in `layout.json` ([map.md](map.md)).
- **Unknown:** Where the file lives before the desktop app exists (repo folder, `~/.crew-city/`, or the OS app-data folder), and how a renamed project or HQ keeps its slot.
- **Check:** Decide during step 4; Electron's `app.getPath("userData")` is the likely home once the app exists.

## Building height from PR size

- **Known:** The ledger has no PR size, so building height is fixed.
- **Unknown:** Whether PR stats (lines changed) from GitHub are worth fetching for height, and what to do for local-only merges, which have no PR.
- **Check:** `gh pr view <url> --json additions,deletions`.

## Map numbers

- **Known:** Lot, block, road, and consolidation sizes in [map.md](map.md) are starting values.
- **Unknown:** Whether 4 × 3 lots per district and consolidating past 12 buildings suit a real fleet.
- **Check:** Run the demo ledger and a real firstmate home in the step 4 city.

## Performance target

- **Known:** Target is 60 fps with about 20 agents and 300 buildings on a laptop.
- **Unknown:** Not measured.
- **Check:** Step 4, with a generated large ledger.
