# Tech research: desktop app

Goal: Crew City ships as a desktop app. Steps 1–4 are built as a local server plus a browser page; this page covers how to wrap that into a desktop app and what it implies for the code now.

Researched October 2026. Version numbers and benchmarks go stale; re-check before committing to a shell.

## What the app needs from a desktop shell

| Need | Why |
| --- | --- |
| Run the Node server (ledger tailer, hook endpoint, vault reader) | All of steps 1–3 is Node/TypeScript |
| Fast, consistent WebGL | 3D city with react-three-fiber (decision 4) |
| macOS and Linux | Firstmate runs on macOS and Linux only |
| Read files anywhere (firstmate home, iCloud vault) | Ledger and vault live outside the app |
| Local HTTP listener | Claude Code `http` hooks POST to it |
| Spawn processes, talk to tmux | Command relay (step 5) |
| Optional: embedded terminals | Watching or typing into a crewmate, like Munder Difflin does with node-pty + xterm.js |
| Microphone, global hotkey, tray, notifications | Voice bar, approval alerts |
| Code signing, notarization, auto-update | Distributing outside a dev machine |

## Options

### Electron

- Ships its own Chromium and Node. Latest stable at time of writing: **Electron 44.7.0** (Oct 7, 2026), Chromium 152, Node 24.21. Stable lines listed: 44, 43, 42. ([releases.electronjs.org](https://releases.electronjs.org/))
- The existing Node server can run directly in Electron's main process. No sidecar and no second language.
- One rendering engine on every OS, so WebGL behaves the same on macOS and Linux.
- node-pty + xterm.js is a proven path for embedded terminals (Munder Difflin uses it).
- Costs: large bundles and higher memory. One macOS test measured 323 MB bundle and 128 MB idle memory ([Better Stack](https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/)). Auto-update usually goes through the community `electron-updater`, with full-bundle downloads ([Tech Insider](https://tech-insider.org/tauri-vs-electron-2026/), whose figures are not independently sourced).
- Security depends on configuration: renderers must run with `contextIsolation` on and `nodeIntegration` off.

### Tauri 2

- Rust backend; renders with the OS webview: WKWebView (macOS), WebKitGTK (Linux), WebView2 (Windows). Much smaller: 57 MB bundle and 109 MB idle in the same Better Stack test.
- Built-in updater and a capability-based permission system that blocks undeclared APIs at the IPC level.
- **Our Node server would run as a sidecar.** The official guide compiles the Node app into a binary with `pkg`, names it with the target triple, lists it under `bundle > externalBin`, and grants `shell:allow-execute` with `sidecar: true`. Communication options are arguments, stdin/stdout, local sockets, or a localhost server. ([Tauri: Node.js as a sidecar](https://v2.tauri.app/learn/sidecar-nodejs/))
- **3D risk on Linux.** Tauri's own docs list WebKitGTK problems: blank or flickering windows and crashes on some setups, most often NVIDIA; WebGL can silently fall back to a slow path; the GPU renderer string is masked. They recommend a non-WebGL fallback for WebGL apps on Linux. ([Tauri: Linux graphics issues](https://v2.tauri.app/develop/debug/linux-graphics/), [WebKit bug 278695](https://bugs.webkit.org/show_bug.cgi?id=278695))
- WebGPU in WKWebView depends on the OS version; Safari's feature flags don't apply to WKWebView ([Apple forums](https://developer.apple.com/forums/thread/770862)). WebGL is enough for react-three-fiber, so this only matters if we later want WebGPU.
- Embedded terminals would need a Rust PTY plugin (for example `tauri-plugin-pty`, early at 0.1.0 ([docs.rs](https://docs.rs/tauri-plugin-pty))) or the Node sidecar.
- Rendering differs per OS, so the UI needs testing on each platform.

### Others looked at

- **Electrobun** (Bun backend): hardest to work with in the Better Stack test; its system webview lacked some media APIs.
- **Deno desktop**: shipped in Deno 2.9.0 (June 2026), still early; a hidden-window crash was reported in the same test.

## Recommendation

**Electron.** It removes the two biggest risks for this app: running our Node server (no sidecar, no Rust) and consistent WebGL on Linux, where firstmate users are. It also keeps embedded terminals open as an option. The cost is bundle size and memory, which matters less for a developer tool that runs alongside several coding agents.

Revisit Tauri if bundle size becomes important and Linux 3D can be tested on real hardware.

## What this means for the code now

- **Keep the server importable.** Export a `startServer({ ledgerPath, port, token })` function so Electron's main process can call it; `src/server/index.ts` stays the CLI entry.
- **Keep the UI a plain web app** (Vite + React when step 4 starts), loaded from the local server or from files. Use relative URLs.
- **Keep the token.** Even inside Electron, the hook endpoint listens on a port that other local processes can reach.
- **Load assets locally** (glTF models, fonts). No CDNs, so the app works offline.
- **Plan for signing early.** Distributing on macOS outside a dev machine needs an Apple Developer ID certificate and notarization, whichever shell is used.
