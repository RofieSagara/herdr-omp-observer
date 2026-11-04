# OMP agents for Herdr

Read-only native OMP subagents and Tasks in Herdr's Agents sidebar, plus a native OMP launcher and official program icon. OMP owns execution; observation does not create substitute subagents, steer or cancel their work, or edit tasks. The launcher starts an ordinary OMP terminal through Herdr.

![Grouped child agents and task-phase dropdowns](preview.png)

## Install

Give your coding agent this request:

```text
Read my Herdr app home's AGENTS.md, then install this integration:
https://github.com/RofieSagara/herdr-omp-observer/blob/main/RECIPE.md
Install the Herdr sidebar mod, the OMP observation extension, and the bundled launcher/icon configuration.
Preserve my existing layout and settings.
```

[RECIPE.md](RECIPE.md) is the installation and rebuild brief. It describes the UI, event/data contracts, collision handling, validation, and safe local/remote installation. No replacement layout or key-binding changes are bundled.

| Component | Install on |
| --- | --- |
| `mods/omp-agents/` | Each computer running a viewing Herdr window |
| `programs.json` merge snippet and `my-icons/omp.svg` | Each viewing Herdr client, preserving its existing configuration |
| `extension/` | Each execution host running the observed OMP profile |

For a local setup both runtime components live on the same computer. For a named remote machine connected through Herdr, the client needs the UI mod and launcher/icon configuration, not an OMP binary. The selected execution host needs OMP; Herdr checks and launches the registered command there. Installing on a host alone cannot configure an inaccessible client.

The OMP extension's default discovery location is `~/.omp/agent/extensions/herdr-observer/`; keep its three production files together. Profile/environment overrides can change that path. The UI belongs under the Herdr app home's `mods/` directory. `space-groups-agents` is not required; `space-groups` folder integration is optional.

Existing OMP sessions need `/reload` or a safe restart; fresh normal sessions discover the extension. Explicit `--no-extensions` launches need an explicit `-e` path. The extension is inert without a host-side `HC_TERMINAL_ID`. Plain `ssh host` typed inside a local terminal is not the named Herdr remote-machine path.

## Native launcher and icon

The bundled [programs.json](programs.json) adds the `omp` registration with default name `OMP`, `run: ["omp"]`, and the full-color [official SVG](my-icons/omp.svg). Merge that one entry; never overwrite a person's entire configuration. Preserve other programs, shell/interpreter settings, and intentional custom OMP launcher/profile arguments. See the recipe for icon-path collisions and safe merge rules.

Open **+ → Start an agent → OMP**. Detection, ordering, shortcuts, and launch location follow Herdr's existing menu; no custom tab bar or replacement menu is required. The same program registration supplies icons to OMP tabs, pane headers, and root Agents rows. OMP's own configuration still selects its model and credentials.

The unchanged artwork comes from [OMP's official repository](https://github.com/can1357/oh-my-pi/blob/main/packages/collab-web/public/favicon.svg), also served at [omp.sh/favicon.svg](https://omp.sh/favicon.svg). Keep `tint: false` to preserve the gradient. Its upstream MIT notice is included in [LICENSE-OMP](LICENSE-OMP).

## UI

Native hc children and observed OMP children share a flat **Child agents** section, with the same title-plus-status-icon rows aligned to the owning agent's icon. There are no tree connectors or visible outcome words. Native terminal rows retain their click-to-peek action; OMP-internal rows remain read-only and show task/model/outcome information in tooltips. Completed OMP children stay visible until a previously unseen child arrives in the same observed session, then older completed entries are hidden. Results first observed in the new batch stay until a later arrival. Failed, aborted, idle, and running children remain visible, including active descendants of hidden completed ancestors. Completed children never promote a working parent into Done.

Cleanup affects only the child-list projection, never the source snapshot, TODOs, or running terminals. Hidden results stay hidden across ordinary heartbeat and temporary read failures. A resumed child becomes visible again. Visibility history is local to the reader: a different publisher/root session or reloading the mod starts a fresh baseline, and the next new child clears that baseline's completed entries.

One disclosure beside each root agent toggles **child agents and tasks together**, expanded by default. Clicking the root program icon performs the same combined toggle; the separate checklist/TODO button has been removed. Inside the details, **Child agents** and every named task phase, such as **Preview video**, form separate rounded, bordered cards containing both the dropdown header and its expanded list. Spacing separates cards from the agent row and from one another; a thin divider separates the header from its padded contents. The header has a subtle surface background, title on the left, and one expand/collapse chevron on the right, without an activity/outcome icon. Status icons remain on child/task rows. Folding a child section leaves tasks visible, folding a phase leaves other sections visible, and a root hide/show round trip preserves those inner choices.

Child rows and one-line task rows start at the same left edge as the root program icon, without L-shaped connectors. Long text truncates, status icons remain at the right, and completed task text is struck through. Task hover reveals only the full task content; accessible labels retain status and blocker details. Task phases preserve all five native states:

Empty or unavailable TODO data displays `No Task Yet`, including phases with no tasks.

- `pending`: open box.
- `in_progress`: spinner while the bridge is live.
- `completed`: check and strikethrough.
- `blocked`: attention icon/color.
- `abandoned`: dash icon, distinct from completion or failure.

A failed TODO tool call does not mark a task failed or replace the last canonical TODO list. TODO completion can automatically start the next pending task, following OMP's own normalization.

## Data and lifecycle

The extension binds to native child sessions and listens to `task:subagent:lifecycle`, `task:subagent:progress`, and `task:subagent:event`. Child identities supply direct parent lineage. Task outcomes come from task lifecycle signals, not merely `agent_end`.

A private atomic JSON snapshot is written under `~/.cache/omp-herdr/<terminal>-<pid>.json` with mode `0600`. Its absolute path is announced on that terminal's `omp.observer` hc label. Herdr polls linked files every 1.5 seconds through `readTextFile(path, { on: machine })`; no HTTP listener or additional network service is used. Main sessions heartbeat every 10 seconds; after 35 seconds without a heartbeat, rows show last-known stale state instead of live spinners. Graceful root shutdown marks the snapshot closed; child shutdown does not close its parent.

The wire format is version 1, scoped by terminal and root session ID. Session changes reset observed children and restore TODOs from the active transcript branch. Observation starts when the extension loads: old child events are not replayed. Manual/eval TODO edits are also discovered from the active branch. The bridge does not modify `shared.json`.

For remote machines, install the OMP extension where OMP runs and the sidebar mod on each viewing Herdr client. Snapshot paths are read on their owning machine through Herdr's existing connection. Current installation and native UI smoke were verified locally on macOS; remote connectivity was not exercised against a second machine.

## Verification

```sh
bun test
herdr-app check ~/.config/herdr-app/mods/omp-agents
```

The original observation bridge was verified with OMP 18.16.0: real native scout execution, live TODO completion/auto-start transitions, mixed hc/OMP child rows, completed strikethrough and all five TODO states, private file mode, graceful closed snapshot, and no Herdr runtime errors. Nested lineage, late lifecycle precedence, wrong-terminal/cyclic snapshot rejection, stale renewal, and changed-publisher async read isolation have behavior-level regression coverage.

Completed-list cleanup has regression coverage for batched arrival/completion, heartbeat retention, nested active descendants, resumed children, session reset, missing snapshots, and terminal isolation. A disposable observer publisher was also exercised through the installed Herdr sidebar; this smoke did not launch or cancel native OMP work.

The redesigned details have interaction coverage using the real view's render descriptions and disclosure callbacks: combined root toggling, independent Child agents/task-phase folding, retained inner choices, native/OMP running-to-completed icons, stale-data non-animation, task-only roots, and nested OMP task owners. The installed native surface was also visually inspected; these callback tests do not claim pointer automation of the live window.

The bundled native launcher and official icon were also exercised through the actual Start an agent menu: a ready OMP 18.16.0 session opened with the icon in the menu, tab, and pane header, without sending a model prompt. This local launcher smoke does not change the unverified second-machine remote boundary.

## Attribution

The sidebar retains the existing space-group sorting and native Agents behavior. Its upstream ancestry is documented in `NOTICE` and covered by `LICENSE-APACHE`. The official OMP artwork retains its separate upstream MIT license in `LICENSE-OMP`.
