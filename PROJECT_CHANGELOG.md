# Project Changelog

Significant changes: features, bugs, architecture decisions, tooling.

**Format**: compact entries, newest first. Details live in the linked documents —
this file says *what changed and why*, not how.

**Where the record lives.** Released versions and their assets are on
[GitHub Releases](https://github.com/VoDmAl/obsidian-git-gutter/releases) and in
`versions.json`; the reasoning behind a decision is in its crystal's
`## Decision Log`. This file is the index that ties the two together.

> Entries before 2026-09-18 were **backfilled** from git history and the v0.2
> crystal on 2026-09-18, when this file was created. They are reconstructions,
> not contemporaneous notes — trust `git log` and the release pages over the
> wording here.

---

## 2026-09-18

### ✨ FEATURE: Untracked files are marked
A file git has never seen has no `HEAD` side to diff against, so every line of it
now counts as added and the status bar reads `+N untracked` — the count *and* the
state, so four distinguishable states survive. Switchable off per vault.
**Ref**: [v0.2 crystal](docs/tasks/v0-2-untracked-and-settings/workitem.md) § Decision Log #4, [README](README.md) § Features

### ✨ FEATURE: Settings tab
Gutter on/off, status bar on/off, untracked marking on/off, refresh delay, and the
two marker colours (empty = follow the theme). Off removes the CodeMirror
extension outright rather than painting an empty gutter.
**Ref**: [README](README.md) § Settings, [CLAUDE.md](CLAUDE.md) § Architecture

### 🏗️ ARCH: Third source file, and a sharper seam
`settings.ts` holds the settings' pure half (shape, defaults, validation) so it
stays testable under `node --test`; the `PluginSettingTab` stays in `main.ts`.
The two-file seam became an invariant: **`main.ts` is the only file that imports
`obsidian`.**
**Ref**: [v0.2 crystal](docs/tasks/v0-2-untracked-and-settings/workitem.md) § Decision Log #5

### 📝 DOCS: Marketplace gate settled — v0.2, not reading mode
`README.md` and `CLAUDE.md` disagreed about what blocks submission to
`obsidianmd/obsidian-releases`. The owner settled it: untracked files + settings,
**not** reading mode (still roadmap `v0.4`). `CLAUDE.md` § Release was the wrong
one and was corrected.
**Ref**: [v0.2 crystal](docs/tasks/v0-2-untracked-and-settings/workitem.md) § Decision Log #3

### 🔧 TOOLING: Both suites grew, and were proved by reverting the fix
33 unit tests (was 18) and 10 e2e scenarios (was 6). Each new path was checked by
reverting the implementation and watching exactly the right tests go red — which
exposed a test that read the gutter's `initialSpacer` instead of a painted marker
and so passed through a reverted feature.
**Ref**: [CLAUDE.md](CLAUDE.md) § Anti-patterns, [v0.2 crystal](docs/tasks/v0-2-untracked-and-settings/workitem.md) § Sidetrack #5

---

## 2026-09-17

### 🐛 BUG: Changes inside Live Preview's collapsed blocks were invisible (0.1.1)
CM6 collects only markers sitting exactly at a visual block's start, and Live
Preview renders raw HTML, tables and callouts as one block spanning many lines —
so every change below such a block's first line went unmarked, silently. Fixed by
folding the block's whole range into one marker via `lineMarker`.
**Ref**: [CLAUDE.md](CLAUDE.md) § Architecture → Live Preview blocks

### ✨ FEATURE: Status bar counter with explicit empty states (0.1.2)
An empty gutter has four causes that look identical — which is how the bug above
stayed invisible for months. The counter names which one: `+N ~M`, `±0`,
`untracked`, `—`.
**Ref**: [README](README.md) § Features

### 🔧 TOOLING: Test suites, and the repo became its own vault
Unit suite over the diff layer (`node --test`, no framework, no build step) plus
an e2e suite against a running Obsidian, with this repository serving as the
vault so the fixture is tracked and no real notes are touched.
**Ref**: [CLAUDE.md](CLAUDE.md) § Conventions

---

## 2026-06-10

### ✨ FEATURE: Initial release (0.1.0)
Gutter markers for lines added or modified vs `HEAD`, in Edit mode and Live
Preview. TypeScript + esbuild, distributed through BRAT, released by CI on tag
push.
**Ref**: [README](README.md), [CLAUDE.md](CLAUDE.md) § Release
