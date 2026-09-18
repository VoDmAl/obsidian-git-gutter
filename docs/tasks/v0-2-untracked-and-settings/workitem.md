---
title: "v0.2 — untracked files + settings tab"
slug: v0-2-untracked-and-settings
description: "Close the two gaps the roadmap assigns to v0.2, and settle what gates marketplace submission"
status: in-progress
session-type: prd-prep
created: 2026-09-18
last-updated: 2026-09-18
---

# v0.2 — untracked files + settings tab

Opened at the end of the session that shipped `0.1.1` and `0.1.2` (collapsed-block
marker fix, status-bar counter, unit + e2e suites). Everything left over from that
session lived as prose in `README.md` and `CLAUDE.md`, which is how the
collapsed-block bug stayed invisible for months — nothing there has a status, and
nothing surfaces on its own. This crystal is the place where v0.2's obligations
are allowed to be open.

## Назначение

Close the two items the roadmap assigns to `v0.2` — untracked-file markers and a
settings tab — and, along the way, settle the one question that blocks planning:
**what actually gates marketplace submission**, since the two documents that say
so disagree (see Decision Log #1).

Constraint: the plugin is in real daily use in the `t23b-content` vault, delivered
by BRAT. Anything shipped here reaches that vault on the next release. The
delivery loop (tag → CI draft → `gh release edit --draft=false` → BRAT) and both
test suites already exist; v0.2 adds features to a working system rather than
building one.

Success criterion: `0.2.0` released through the documented flow, with markers
appearing on untracked files, a settings tab that changes real behaviour, and
both suites green — including a fresh revert-the-fix check for any new marker
path.

## Текущая модель

State as of 2026-09-18, after `0.1.2`:

- **Shipped and verified in the field.** `0.1.2` is published and delivered to
  `t23b-content` via BRAT; the collapsed-block fix and the status-bar counter were
  both checked on the delivered build, not just locally.
- **Architecture is two files.** `diff.ts` — parser, markers, `StateField`, gutter
  extension; imports nothing from `obsidian`, which is what makes it testable.
  `main.ts` — the plugin class, git invocation, status bar. Keep the seam: the
  unit suite depends on it.
- **The gutter paints per *visual* block.** CM6 collects only markers positioned
  exactly at a block's start, so `lineMarker` folds a whole collapsed block's range
  into one marker. Consequence that constrains any new marker work: **inside a
  rendered block the marker covers the block, not the line** — per-line precision
  exists only in Source mode.
- **The status bar has four states that must stay distinguishable**: `+N ~M`,
  `±0`, `untracked`, `—`. Collapsing any two re-creates the original defect (an
  empty gutter that cannot be told apart from a broken one). This is the constraint
  untracked-file work runs straight into — see Sidetrack #1.
- **Two test suites.** `npm test` — 18 unit tests over `diff.ts`, gates CI.
  `npm run test:e2e` — 6 scenarios against a running Obsidian; the repo is its own
  vault (`.obsidian/` at the root, fixture at `tests/e2e/fixtures/`). E2e cannot
  run in CI and is a local gate.
- **Both suites were validated by reverting the fix** and watching exactly the
  right tests go red. Any new marker behaviour owes the same check — see
  `CLAUDE.md` § Conventions, including the stale-bundle trap that made the e2e
  suite pass through a reintroduced bug once.

## Decision Log

### #1 / 2026-09-18 / The marketplace gate is stated twice, and the two disagree

**Source:** assistant
**Basis:** observed
**Basis-detail:** Read both files in the working tree at commit `d9c458f`.
`README.md:57` schedules reading mode for `v0.4`: *"`v0.4` — reading-mode markers
via markdown post-processor (approximation; line mapping is lossier in rendered
HTML)."* `CLAUDE.md:33` says: *"Marketplace submission (PR to
`obsidianmd/obsidian-releases`) is deferred until v0.2+ closes the obvious gaps
(untracked files, reading mode)."* Transcribed rather than stored: both files are
in this repository at that commit and the claim is fully reconstructed by the two
quotes.
**Context:** Planning v0.2 requires knowing whether finishing it unblocks
marketplace submission.
**Why:** Recorded rather than resolved, because resolving it is a product call
that belongs to the owner, not a documentation tidy-up. Taken literally, CLAUDE.md
makes submission wait for reading mode, which the roadmap does not schedule until
`v0.4` — two releases after the gate is described as lifting.
**Implication:** Until this is settled, "does v0.2 unblock the marketplace?" has no
answer, and the scope of v0.2 cannot be called complete. First item in Next
actions.

### #2 / 2026-09-18 / v0.2 is a feature release; bugfixes ship as 0.1.x

**Source:** both
**Basis:** user-stated
**Basis-detail:** In the session of 2026-09-17/18 the assistant proposed `0.1.1`
rather than `0.2.0` for the collapsed-block fix, on the grounds that the roadmap
reserves `v0.2` for untracked files and the settings tab; the user accepted, and
the same reasoning was applied again for `0.1.2` (the status-bar counter, a
feature, still shipped as a patch to avoid burning the number). No objection was
raised either time.
**Context:** Two releases went out mid-session and both could plausibly have
claimed `0.2.0`.
**Why:** The number carries meaning to anyone reading the roadmap: `v0.2` is
supposed to mean *untracked files and settings are done*. Spending it on a bugfix
would have made the roadmap lie.
**Implication:** `0.2.0` is reserved for this crystal's scope. Anything shipped
before it is `0.1.x`, even when it adds a feature.

## Sidetracks

### #1. Untracked markers and the `untracked` status state collide

**Возникло в:** `## Текущая модель`, while writing down the four status states
**Описание:** If an untracked file has every line marked as added, the status bar
saying `untracked` becomes odd — the gutter is full, but the counter reports no
count. Either the state becomes `+N (untracked)`, or the counter keeps `untracked`
and the two disagree. This needs deciding before the marker work, not after: the
whole reason the counter exists is that an empty gutter and a broken one used to
look identical.

**Status:** open

### #2. Reading mode has no scheduled home, but gates the marketplace in one doc

**Возникло в:** Decision Log #1
**Описание:** Beyond the contradiction itself, the reading-mode approach is
recorded as an anti-pattern in `CLAUDE.md`: naive line→line mapping through the
markdown post-processor produces wrong gutter positions, because rendering
collapses and expands lines. So whatever v0.4 does, it is not a small job — which
is an argument for removing it from the marketplace gate rather than from the
roadmap.

**Status:** open

### #3. `.obsidian/` at the repo root is new, and marketplace reviewers will see it

**Возникло в:** the 0.1.2 session, when the repo became its own vault
**Описание:** The repo now ships `.obsidian/app.json` and
`.obsidian/community-plugins.json` so it can be opened as a vault for dogfooding
and e2e. Harmless as far as anyone here knows, but nobody has checked whether the
`obsidianmd/obsidian-releases` review process objects to a vault config in a plugin
repository. Worth a look before submission, not before v0.2.

**Status:** open

### #4. Side panes still show a stale gutter

**Возникло в:** `README.md` § Known limitations
**Описание:** Refresh hooks watch the active leaf only, so a split pane keeps its
last-painted gutter until it becomes active. Not in v0.2's scope; parked here so it
stops living only as a README bullet. A settings tab with a debounce interval
touches the same refresh path, so it may be cheap to fix while in there.

**Status:** open

## Next actions

- [ ] Settle Decision Log #1 with the owner: does marketplace submission wait for
      reading mode (`v0.4`), or only for untracked files + settings (`v0.2`)? Write
      the answer as a DL entry, then correct whichever document is wrong.
- [ ] Decide Sidetrack #1 — what the status bar says for an untracked file once its
      lines are marked — before writing the marker code.
- [ ] Implement untracked-file markers: pre-check with
      `git ls-files --others --exclude-standard`, mark every line as added. The
      `isTracked()` helper in `main.ts` already distinguishes the case.
- [ ] Add unit tests for the untracked path in `tests/diff.test.ts`, and an e2e
      scenario in `tests/e2e/gutter.e2e.mjs` — the probe file is already created and
      torn down there.
- [ ] Verify the new tests by reverting the implementation and watching them go
      red. Re-read `CLAUDE.md` § Conventions on the stale-bundle trap first.
- [ ] Design the settings tab: colour customisation, debounce interval, on/off per
      vault. Decide what persists and how defaults are expressed.
- [ ] Implement the settings tab, including wiring the debounce interval through to
      the existing 400 ms `debounce()` in `main.ts`.
- [ ] Update `README.md` §§ Features / Known limitations / Roadmap and
      `CLAUDE.md` § Architecture for both features.
- [ ] Release `0.2.0` through the documented flow (`CLAUDE.md` § Release), verify
      delivery to `t23b-content` via BRAT, and run the e2e suite against the
      delivered build.
- [ ] Tell `t23b-content` what changed, via `/vdm:intercom send` — untracked
      markers alter what its agent sees when it creates a new page.

## References

- `README.md` §§ Known limitations, Roadmap — the prose this crystal replaces as
  the home for open work.
- `CLAUDE.md` §§ Release, Architecture, Conventions, Anti-patterns — the release
  flow, the two-file seam, the test discipline, and why reading mode is not a small
  job.
- Released builds: https://github.com/VoDmAl/obsidian-git-gutter/releases/tag/0.1.2
  (status-bar counter), `.../0.1.1` (collapsed-block fix).
- Incoming bug reports that started the previous session, archived in the intercom
  store: `gutter-misses-lines-inside-rendered-html`,
  `gutter-blast-radius-and-second-probe` (inbox
  `~/.claude/vdm/intercom/obsidian-git-gutter/_done/`). Not copied here: they are
  another repository's correspondence, and the store is outside every repo by
  design.
