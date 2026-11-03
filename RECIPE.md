# OMP agents for Herdr

A Herdr Agents sidebar that shows OMP's own subagents beside native Herdr children, plus a checklist button that expands each OMP terminal's task list. Tasks are compact one-line rows with L-shaped connectors and status icons; hover reveals the complete task content. This is one integration package with two components: a Herdr UI mod and an OMP observation extension. It does not replace OMP's delegation or create substitute agent terminals.

![OMP agents for Herdr](preview.png)

## What you see

- Retain the existing Agents sidebar: theme `chrome`, 13px base text, priority/space/folder sorting, pinned agents, collapsible groups, and native child terminal rows. Reuse the person's existing Agents block, not a replacement window layout.
- Main agent rows remain 30px high, with the program icon, agent/space detail, optional remote machine label, status, and existing pin/fold controls.
- OMP child rows share the existing tree appearance: 26px high, 12.5px text, muted child name, connector lines, and a small outcome at the right. A live running child has a native rotating ring. Its tooltip includes its task and model. Each owning terminal has a separate child namespace, including OMP children beneath a native hc child terminal.
- Each OMP terminal row has a persistent 22px checklist button with a 15px icon. Opening it inserts its task list below its children, without a `TODO` separator or extra status line per task.
- Phase names use 11.5px semibold text and align with the parent agent icon. Each task is a 26px-high single line. An L-shaped connector starts at the phase label's left edge, is 7px wide and 13px high, and leaves 4px before the text. Long content truncates with an ellipsis. Its status icon stays at the right; completed content is struck through. The tooltip contains only the full task content.
- Task marks: pending is an open box, in progress is a native spinner while live, completed is a check, blocked is an attention mark, and abandoned is a dash. Use the current theme's muted/status colors. Do not invent a failed TODO state: OMP's five task states are `pending`, `in_progress`, `completed`, `blocked`, and `abandoned`.
- Missing or empty task data says exactly `No Task Yet`, including a phase with no tasks. Retained stale or closed snapshots are visibly last-known data; they must not display live activity spinners.

## How it behaves

- Root statuses follow Herdr: working is a 12px rotating ring in the theme's working color; blocked is a themed `!` badge in compact/priority rows or `Needs you` pill otherwise; done is a filled 7px dot; idle is a 7px outlined ring. Priority order is blocked, done, working, idle. Keep a viewed Done row in its section until focus leaves, rather than moving it under the pointer.
- Clicking a root focuses its pane. Hover highlights it and replaces its elapsed-state duration with a pin button; clicking the pin stops propagation and moves the row into/out of the top Pinned section. Clicking a child fold chevron or a root's program icon folds only its child tree; clicking a section header folds that section. Preserve the child count and urgency indicator while folded.
- The 41px Agents header has a sort button opening a 200×171px popup with Priority, Grouped by space, and Grouped by folder choices. Choosing one updates shared sort state and closes the popup. Group headers are 30px high. The scrolling list fills the remaining height.
- A sidebar narrower than 160px becomes a numbered rail: 26px root rows with compact status and OMP checklist controls. Child and task details are hidden in the rail; widen it to read them. No additional keyboard bindings are required; agent navigation follows the displayed root order.
- Clicking the checklist stops event propagation and toggles only the task list. It does not focus another pane, fold children, change a task, or remove subagent rows. Task expansion is independent of the main child fold.
- Native Herdr child rows keep their existing terminal-peek behavior. Internal OMP child rows are observation-only: no synthetic terminal IDs may be sent to Herdr's focus, peek, keep, kill, or messaging commands.
- Preserve priority, grouped-by-space, and grouped-by-folder views. `space-groups` is optional: read its shared state when present, otherwise keep the ordinary ungrouped list. `space-groups-agents` is not a required runtime dependency; its adapted UI is already included.
- Keep native child tree order, grouping, pinning, and agent keyboard navigation. A completed OMP child must not move its still-working parent into Done. Failed OMP runs remain distinct from completed or aborted runs.
- OMP owns the work and its TODOs. Observe native lifecycle/progress signals, including child bindings; never wrap or replace `task`, eval agents, or workpool execution just to populate this UI. `agent_end` means a loop ended, not necessarily successful task completion.
- Changes to a session's canonical task list update the UI, including successful tool mutations and persisted manual/eval edits. Failed or pure `view` TODO results must not replace the last canonical mutation. Preserve automatic next-task activation as supplied by OMP.
- Start observing when the extension loads. Events from before that point are not replayed; do not promise reconstruction of previously running children. Session changes clear the previous observed children and restore task state from the new active transcript branch.

## Built from

### Package files

```text
RECIPE.md
README.md
preview.png
NOTICE
LICENSE-APACHE
extension/index.ts
extension/state.ts
extension/transport.ts
extension/state.test.ts
mods/omp-agents/main.js
mods/omp-agents/observer.js
mods/omp-agents/todo.svg
mods/omp-agents/mod.json
tests/observer.test.js
```

The checked-in files are one build of this brief, not prerequisites for rebuilding from an empty folder. Use the installed Herdr and OMP APIs and the contracts below; no author's private setup is required. This recipe is not an executable OMP plugin manifest and does not by itself make `omp install <url>` work.

- The Herdr view is a GPUI JavaScript `View`, using `gpui-kit`, `gpui-base`, and the installed `herdr` module. Its metadata is `{ "place": "none", "title": "Agents + OMP" }`.
- `main.js` retains the adapted grouped Agents view and uses `observer.js` for snapshot reading/validation and tree projection. Read `agents()`, `terminals()`, `panes()`, `spaces()`, `focused()`, `theme()`, `layout()`, and shared state. Use the shipped `mods/workspace-chrome/` icons and the bundled `mods/omp-agents/todo.svg`. Do not import code from another mod at runtime.
- A normal view needs no special props. The same mod serves the sort overlay with `props().sortMenu === true` and closes `props().overlay` after selection. Use `openOverlay`, `closeOverlay`, `setShared("agents.sort", ...)`, `setAgentOrder`, `run("pane.focus", { pane })`, and `run("terminal.peek", { terminal })` for those existing interactions. Local pin order and status-change timestamps use per-view `localStorage`; child/task expansion is view-local. `window()` and `layout()` supply the sidebar rail geometry, with `layout.resize` restoring its stored width.
- The OMP extension uses `ExtensionAPI`, `pi.zod`, managed timers, and `pi.events.on` subscriptions for `task:subagent:lifecycle`, `task:subagent:progress`, and `task:subagent:event`. Every inherited extension binding contributes its own session's events. `ctx.agent` supplies direct child lineage; only the main binding owns the root snapshot's heartbeat and close.
- `state.ts` owns session-scoped child/task state. Lifecycle outcomes outrank late loop/progress observations. `transport.ts` serializes and coalesces atomic snapshot writes through private temporary files and rename. Observation failures must not stop the user's agent.
- Restore canonical tasks by scanning `ctx.sessionManager.getBranch()` from newest to oldest for `custom` entries of type `user_todo_edit` containing `data.phases`, or successful mutating `todo` tool results containing `details.phases`. Ignore errors and `op: "view"` results. Recheck this branch every 1500ms while the root binding is active, so persisted edits not emitted as ordinary tool events are included.
- Production extension files are `index.ts`, `state.ts`, and `transport.ts`; keep them together. They need no separately installed npm runtime dependency in the verified OMP binary.
- On the machine running OMP, write a private snapshot to `~/.cache/omp-herdr/<terminal>-<pid>.json`, mode `0600`. Publish its absolute path once on the owning core terminal using `hc label <HC_TERMINAL_ID> omp.observer=<absolute-path>`.
- Wire version 1 includes local `terminalId`, `pid`, root `sessionId`, `rootAgentId`, epoch-ms `updatedAt`, `closed`, observed `children`, and task `todos`. Child rows carry `id`, `parentId`, agent type, task summary, outcome, model, and update time. TODOs preserve `{ name, tasks: [{ content, status, blocker? }] }`.
- The Herdr reader finds `terminals()[i].labels["omp.observer"]` and reads that path through `readTextFile(path, { on: machine })`. Strip the `machine/` prefix only for checking the snapshot's local terminal ID. Poll every 1500ms with no overlapping read pass, ignore late reads from replaced publishers, and reject malformed, cross-terminal, disconnected, or cyclic trees. Keep heartbeats at 10 seconds and mark data stale after 35 seconds.

### Install both components

First read the running client's generated Herdr `AGENTS.md` and type files, plus this recipe and the relevant source files. Inspect the current layout and OMP profile; do not assume the author's personal layout name, paths, machine aliases, or terminal addresses.

Before installing, explain that the extension runs `hc label` and writes private local snapshots outside its code folder. The mod reads those linked files locally or through Herdr's existing remote connection. There is no added HTTP listener, cloud endpoint, or telemetry service. Snapshot content can contain task text and model names and must not be published.

1. **Identify the two installation targets.** The client is the computer running the Herdr window. The execution host is where the observed OMP process runs. They may be the same computer.
2. **Install the UI on each viewing client.** Copy `mods/omp-agents/` into that client's Herdr app home's `mods/` directory (default `~/.config/herdr-app/mods/omp-agents`). Include `NOTICE` and `LICENSE-APACHE` with the installed mod. Do not install the UI only on a remote execution host that has no viewing Herdr window.
3. **Install the extension on each execution host.** In the active OMP profile's `extensions/` directory, create a `herdr-observer/` folder containing the three production extension files. The default location is `~/.omp/agent/extensions/herdr-observer/`; named profiles, `PI_CODING_AGENT_DIR`, and initialized XDG layouts can change the actual location. Alternatively link that folder to a persistent checkout's `extension/` directory on the same machine. Never link to a disposable download directory or a path that exists only on the client.
4. **Respect collisions.** Never silently overwrite a person's existing mod or extension. If an unrelated `omp-agents` mod owns the name, choose a new folder name and rewrite the mod's `MOD` value, its own `mods/omp-agents/` asset paths, and the layout reference. For an extension-name collision, choose a free extension folder name. An update of this package must leave exactly one active copy of the observation extension; two copies would both publish the same terminal snapshot. Preserve user edits or ask before replacing them.
5. **Connect the client's sidebar.** Use `herdr-app status` to identify the selected layout. If it is shipped/read-only, clone it through `layout.clone` first so Herdr preserves its click/look state. In that personal layout, replace only the existing Agents block's `content.mod` with `omp-agents` (or the selected collision-free name). Keep block IDs, sizes, placement, frame, appearance, keys, spaces, and unrelated panels. Do not require `space-groups`, `space-groups-agents`, `auto-tabs`, or a particular personal theme. Do not copy the author's layout, `shared.json`, `data/`, `view.json`, or `layouts/.state/`.
6. **Activate safely.** Run `herdr-app check <installed-mod-directory>`, then inspect the actual window and `herdr-app status`. Fresh ordinary OMP sessions discover the extension. Existing sessions need `/reload` or a restart, performed only when safe for their ongoing work. Explicit `--no-extensions` launches need an explicit `-e <extension/index.ts>` path. Do not restart the user's core or kill agents to activate this package.
7. **Verify data, not just installation.** On the execution host, confirm that an OMP launched by that machine's core has `HC_TERMINAL_ID`, that `hc` is available, that its `omp.observer` label points to a readable private snapshot, and that the snapshot matches that local terminal ID. Spawn a small read-only native OMP child and observe its real lifecycle in the sidebar. Open/close Tasks, confirm long-content tooltips and completion icons, and preserve native child rows. Do not fabricate snapshot entries or substitute a new hc agent for this check.

### Remote installation boundary

For a named remote machine connected through Herdr, the **client needs Herdr and this UI mod, not OMP**. The **host needs herdr-core, OMP, and this extension**. Labels and snapshot reads travel through the existing Herdr machine connection; no snapshot syncing or extra tunnel is needed by this design.

If an installer agent runs only on the execution host, it cannot assume it can modify the client's files. Install the host component and provide the client-side recipe step, or use an explicitly available connection to the client. Do not claim both sides installed until both are verified. Never install Herdr UI files into a guessed remote home as a substitute.

Typing `ssh host` inside a local shell is not equivalent to starting an OMP terminal on a named Herdr remote machine. That shell does not automatically provide a host-side core terminal identity and label route. This package does not support that plain nested-SSH arrangement directly.

## Watch out

- Verified locally on macOS with **Herdr 0.1.12** and **OMP 18.16.0**. The cross-machine reader is implemented, but a second-machine SSH installation has **not** been exercised end-to-end. Validate it on the intended host/client before calling that installation verified. The current reader expects POSIX absolute snapshot paths; do not claim Windows execution-host support.
- `space-groups` is optional shared-data integration, not a code dependency. The original `space-groups-agents` mod is unnecessary. Preserve its Apache-2.0 ancestry and modifications in `NOTICE`/`LICENSE-APACHE`.
- The extension is inert without `HC_TERMINAL_ID`. Keep core terminal IDs distinct from names, session IDs, and remote `machine/terminal` addresses.
- `pi.events` is scoped to its binding. A main-only listener is not a tree-wide guarantee; keep inherited child listeners and direct parent identities. Do not infer task completion from `agent_end`, or infer failure merely because a retained session is idle/closed.
- Canonical TODO restoration scans the active transcript branch, ignoring failed or pure-view mutations. Manual/eval changes may need the managed 1500ms branch scan. Never replace source task states with UI guesses.
- `No Task Yet` intentionally covers both empty and unavailable data. Diagnose a missing label, profile mismatch, disabled extension, stale file, or remote read failure through the actual host state, not by assuming every empty UI means OMP has no tasks.
- GPUI has no DOM, HTML/CSS, Node UI APIs, or browser event loop. Use the installed generated types, managed tasks/timers, current theme colors, native `.spin(900)`, and content tooltips. Never retain a callback's `cx` for later unrelated work.
- The reader handles files up to Herdr's `readTextFile` limit (1 MiB). Do not publish session artifacts, cache snapshots, tokens, machine lists, generated editor/type files, or user task data. The preview must be a crop of a real safe demo's sidebar, not a screenshot of a personal workspace.
- Read-only means no task edits, steering, cancellation, terminal attachment for virtual children, or promise of child events from before extension activation. Do not add those features while following this recipe.

## Done when

1. `bun test` passes and `herdr-app check <installed-mod>` passes; the selected personal layout shows the mod without runtime errors.
2. A native OMP subagent appears beneath its owning terminal, can update from running to a real terminal outcome, and stays distinct from native hc children. Split/client terminal IDs do not cross-contaminate snapshots.
3. The checklist opens task phases and compact L-connected task rows; clicking it again hides only Tasks. Content truncates, the complete content appears on hover without a status suffix, completed text is struck through, and the other four native states remain distinct. Empty/missing data reads `No Task Yet`.
4. A successful task mutation updates the list; a failed/view call does not corrupt it. Session changes reset observed children and restore the new branch's tasks. Child shutdown does not close the root snapshot; stale/closed data never looks actively running.
5. Existing sorting, grouping, pins, native child actions, and unrelated layout/keys survive. No mandatory installation of third-party grouping mods was introduced.
6. For a remote installation, confirm the client UI and the host extension separately and exercise the named Herdr machine route. If the second machine is unavailable, report remote verification as outstanding rather than claiming it passed.
7. The public package has its source, recipe, actual safe `preview.png`, tests, and license attribution. Its repository has topic `herdr-mod`. No personal configuration, session history, snapshot, secret, or author-machine path is included.
