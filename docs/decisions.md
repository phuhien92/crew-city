# Decisions

Each entry records what was decided, why, and what was considered instead. Newest last.

## 1. Use firstmate as the orchestrator

**Decided:** Crew City sits on top of [firstmate](https://github.com/kunchenguid/firstmate).

**Why:**
- Firstmate's task lifecycle (dispatch → build → PR → merge → teardown) maps one-to-one onto a city's construction lots.
- Its workers are disposable and memoryless, which leaves long-term context to COWORK OS instead of competing with it.
- Merge authority is structural (project modes `no-mistakes`, `direct-PR`, `local-only`), and it publishes a documented, append-only ledger for outside tools.

**Considered:**
- [Munder Difflin](https://github.com/HarnessMD/munder-difflin): an Electron app with its own orchestrator ("Michael"), approvals queue, agent cards, worktrees, voice, and a built-in memory layer, on a 2D Pixi.js floor. It already covers much of the UI, but it would mean a second orchestrator next to firstmate and a second memory store next to COWORK OS. Its agents are persistent coworkers, which fits an office better than a city.

## 2. Build a standalone wrapper, not a fork

**Decided:** Crew City is its own project that reads from firstmate, Claude Code hooks, and the vault.

**Why:** It combines three sources into one custom UI. A fork of one tool would carry that tool's assumptions and need constant rebasing.

**Considered:**
- Forking [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents): MIT, React + Canvas 2D, detects Claude Code sessions through hooks and transcripts, with a layout editor. Its code and ideas can still be reused (MIT), but it renders top-down pixel art with a 64×64 tile limit and only supports Claude Code.
- Using firstmate and Pixel Agents side by side with no new code: works for seeing crewmates as characters, but can't show task-level events, city visuals, or approvals.

## 3. Leave firstmate unmodified

**Decided:** No changes to firstmate. Read the ledger; send commands only through the first mate.

**Why:** Firstmate is a distro that updates itself (`/updatefirstmate`). Local edits would conflict with every update, and the ledger exists for exactly this kind of reader.

## 4. 3D isometric look with react-three-fiber

**Decided:** Low-poly 3D, isometric orthographic camera, built with react-three-fiber (Three.js as React components) and glTF assets.

**Why:** Matches the target look (a low-poly isometric office). In 3D, depth sorting, lighting, and hit-testing come from the GPU, which is simpler than hand-drawn isometric sprites. React matches the author's experience.

**Considered:** 2D top-down pixel art (Canvas 2D or Pixi.js). Less work for the first visuals, but not the target look.

## 5. Desktop app is the final goal; build browser first

**Decided:** The shipped product is a desktop app. Steps 1–4 run as a local server plus a browser page, and the desktop shell wraps them afterward.

**Why:** Fastest to build and test, and the server and UI carry over unchanged if the server stays importable and the UI stays a plain web app. See [tech-research.md](tech-research.md).

## 9. Electron as the desktop shell (proposed)

**Proposed:** Electron, pending a spike once the 3D city exists.

**Why:** The server is Node and runs in Electron's main process with no sidecar. Bundled Chromium gives the same WebGL on macOS and Linux; Tauri's own docs list WebKitGTK rendering and WebGL problems on Linux. node-pty + xterm.js keep embedded terminals possible.

**Considered:** Tauri 2: much smaller bundles, built-in updater, capability permissions, but the Node server would run as a `pkg`-compiled sidecar and 3D on Linux is a known risk. Electrobun and Deno desktop: too early.

## 6. Vault read-only at first

**Decided:** The first version of the vault reader never writes to COWORK OS.

**Why:** The vault is the long-term record. Writing rules (where reports go, facts-only `MEMORY.md`) should be settled before any agent can write there.

## 7. Build order

**Decided:**
1. Ledger tailer + list UI
2. Hook endpoint and approvals
3. Vault reader
4. City renderer
5. Command relay and voice

**Why:** Prove the data end to end with a plain UI before investing in graphics.

## 8. Plain Node server, no framework

**Decided (step 1):** Node's `http` module plus `ws`, TypeScript run with `tsx`, tests with Vitest.

**Why:** The server serves one page and one WebSocket. A framework can be added if the API grows.
