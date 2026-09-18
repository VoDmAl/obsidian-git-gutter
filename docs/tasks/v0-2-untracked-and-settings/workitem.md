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
- **Architecture is three files** (was two before this crystal). `diff.ts` —
  parser, markers, `StateField`, gutter extension. `settings.ts` — settings shape,
  defaults, validation. Neither imports `obsidian`, which is what makes them
  testable. `main.ts` — the plugin class, git invocation, status bar, settings
  tab. The seam hardened into an invariant: **`main.ts` is the only file that
  imports `obsidian`** (Decision Log #5).
- **The gutter paints per *visual* block.** CM6 collects only markers positioned
  exactly at a block's start, so `lineMarker` folds a whole collapsed block's range
  into one marker. Consequence that constrains any new marker work: **inside a
  rendered block the marker covers the block, not the line** — per-line precision
  exists only in Source mode.
- **The status bar has four states that must stay distinguishable**: `+N ~M`,
  `±0`, `untracked`, `—`. Collapsing any two re-creates the original defect (an
  empty gutter that cannot be told apart from a broken one). This is the constraint
  untracked-file work runs straight into — see Sidetrack #1.
- **Two test suites.** `npm test` — 33 unit tests over `diff.ts` and `settings.ts`
  (was 18), gates CI. `npm run test:e2e` — 10 scenarios against a running Obsidian
  (was 6); the repo is its own vault (`.obsidian/` at the root, fixture at
  `tests/e2e/fixtures/`). E2e cannot run in CI and is a local gate.
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

### #3 / 2026-09-18 / The marketplace gate is v0.2 only; reading mode is not a condition

**Source:** user
**Basis:** user-stated
**Basis-detail:** Asked directly, with the contradiction of Decision Log #1 laid
out and three options offered (gate on v0.2 / gate on v0.4 / no marketplace at
all). The owner chose "только v0.2 (untracked + settings)".
**Context:** Decision Log #1 recorded that `README.md:57` and `CLAUDE.md:33`
disagree about what blocks submission to `obsidianmd/obsidian-releases`.
**Why:** Reading mode is not a small job — `CLAUDE.md` § Anti-patterns records
that naive line→line mapping through the markdown post-processor produces wrong
gutter positions — and making submission wait on it would park the plugin outside
the marketplace for two more releases with no benefit to anyone installing it.
Untracked files and a settings tab are the gaps a reviewer would actually notice.
**Implication:** `CLAUDE.md:33` is the document that is wrong and gets corrected:
reading mode leaves the gate, stays on the roadmap at `v0.4`. Shipping `0.2.0`
closes the gate. Sidetrack #2 resolved; Sidetrack #3 (`.obsidian/` in the repo)
becomes live rather than hypothetical, since submission is now near.

### #4 / 2026-09-18 / An untracked file reads `+N untracked` — count and state both

**Source:** user
**Basis:** user-stated
**Basis-detail:** Asked directly as Sidetrack #1, with three renderings offered:
`+N untracked`, `+N` alone with the state demoted to the tooltip, or `untracked`
alone with no count. The owner chose `+N untracked`.
**Context:** Once every line of an untracked file is marked green, a status bar
that still says only `untracked` contradicts a full gutter.
**Why:** The status bar exists because an empty gutter has four causes that look
identical. Dropping the word `untracked` (option 2) collapses two of those four
states into one and re-creates exactly that defect; dropping the count (option 3)
leaves the counter disagreeing with what is painted. Showing both keeps four
distinguishable states and keeps the counter honest about the gutter.
**Implication:** `GutterStatus`'s `untracked` variant carries `marks`, like
`changes` does. With marking switched off (Decision Log #5) or on an empty file
the count is zero and the bar falls back to a bare `untracked`, which stays
distinct from `±0`.

### #5 / 2026-09-18 / Settings = roadmap three + an untracked toggle; only `main.ts` imports `obsidian`

**Source:** both
**Basis:** user-stated
**Basis-detail:** The owner chose "всё из roadmap + тумблер untracked" over the
bare roadmap list and over a debounce-only minimum. The file layout that follows
is the assistant's call.
**Context:** `README.md` § Roadmap scopes the tab as "colour customisation,
debounce interval, on/off per vault".
**Why (toggle):** Marking every line of an untracked file paints the whole gutter
green. In a vault where many notes are untracked that is noise rather than signal,
and the person it annoys has no way out short of uninstalling.
**Why (layout):** The unit suite runs `diff.ts` directly under `node --test`, which
works only because nothing in it imports `obsidian`. Settings have a pure half
(shape, defaults, validation — worth testing) and an Obsidian half (`PluginSettingTab`).
Splitting them gives `settings.ts` with no `obsidian` import and leaves the tab in
`main.ts`, which promotes the two-file seam into a sharper invariant: **`main.ts` is
the only file that imports `obsidian`.**
**Implication:** Three source files instead of two. `CLAUDE.md` § Architecture and
§ Conventions have to say so, and the invariant is what any later file must respect.

## Sidetracks

### #1. Untracked markers and the `untracked` status state collide

**Возникло в:** `## Текущая модель`, while writing down the four status states
**Описание:** If an untracked file has every line marked as added, the status bar
saying `untracked` becomes odd — the gutter is full, but the counter reports no
count. Either the state becomes `+N (untracked)`, or the counter keeps `untracked`
and the two disagree. This needs deciding before the marker work, not after: the
whole reason the counter exists is that an empty gutter and a broken one used to
look identical.

**Status:** resolved — Decision Log #4. The bar reads `+N untracked`: both the
count and the state, so neither the gutter nor the four-state rule loses.

### #2. Reading mode has no scheduled home, but gates the marketplace in one doc

**Возникло в:** Decision Log #1
**Описание:** Beyond the contradiction itself, the reading-mode approach is
recorded as an anti-pattern in `CLAUDE.md`: naive line→line mapping through the
markdown post-processor produces wrong gutter positions, because rendering
collapses and expands lines. So whatever v0.4 does, it is not a small job — which
is an argument for removing it from the marketplace gate rather than from the
roadmap.

**Status:** resolved — Decision Log #3 took exactly that argument: reading mode
leaves the gate and stays on the roadmap at `v0.4`.

### #3. `.obsidian/` at the repo root is new, and marketplace reviewers will see it

**Возникло в:** the 0.1.2 session, when the repo became its own vault
**Описание:** The repo now ships `.obsidian/app.json` and
`.obsidian/community-plugins.json` so it can be opened as a vault for dogfooding
and e2e. Harmless as far as anyone here knows, but nobody has checked whether the
`obsidianmd/obsidian-releases` review process objects to a vault config in a plugin
repository. Worth a look before submission, not before v0.2.

**Status:** open — and no longer hypothetical: Decision Log #3 puts submission
directly after `0.2.0`, so this is the last thing standing between the release and
the PR.

### #4. Side panes still show a stale gutter

**Возникло в:** `README.md` § Known limitations
**Описание:** Refresh hooks watch the active leaf only, so a split pane keeps its
last-painted gutter until it becomes active. Not in v0.2's scope; parked here so it
stops living only as a README bullet. A settings tab with a debounce interval
touches the same refresh path, so it may be cheap to fix while in there.

**Status:** open

### #5. An e2e assertion can read the gutter's spacer instead of a marker

**Возникло в:** the revert-the-fix check on the settings scenarios
**Описание:** The colour scenario stayed green with the untracked feature
deliberately reverted and the gutter empty. Cause: `gutter()`'s `initialSpacer`
renders an element carrying the same `git-gutter-marker git-gutter-added`
classes as a real marker, and exists whether or not anything is marked — so
`querySelector('.git-gutter-marker')` found *something* in an empty gutter. The
helper now walks `.cm-gutterElement`s and skips any with no `firstChild` or zero
height, which is the filter `gutterMarkers()` already used — which is why the
older scenarios were never fooled.

**Status:** resolved — helper fixed, re-checked against the same revert (the
scenario went red), recorded in `CLAUDE.md` § Anti-patterns. Worth keeping
visible: it is the second time a test in this repo passed through a reverted
feature, after the stale-bundle trap.

## Next actions

- [x] Settle Decision Log #1 with the owner: does marketplace submission wait for
      reading mode (`v0.4`), or only for untracked files + settings (`v0.2`)? Write
      the answer as a DL entry, then correct whichever document is wrong.
      → Decision Log #3; `CLAUDE.md` § Release rewritten, `README.md` left alone.
- [x] Decide Sidetrack #1 — what the status bar says for an untracked file once its
      lines are marked — before writing the marker code. → Decision Log #4: `+N untracked`.
- [x] Implement untracked-file markers. Done via the existing `isTracked()`
      (`git ls-files --error-unmatch`) rather than the `--others` pre-check the
      roadmap proposed — the plugin already ran it on the empty-diff branch, so
      the feature cost no extra git call. `markAllAdded()` in `diff.ts` marks
      every line of the buffer.
- [x] Tests. `tests/diff.test.ts` +4 (untracked marks), `tests/settings.test.ts`
      new (+11, validation), e2e rewritten around the probe +4 scenarios:
      33 unit / 10 e2e, both green.
- [x] Revert-the-fix check, in three passes. (1) `markAllAdded` → `[]` plus the
      settings validation: 4 unit red. (2) the untracked branch of `main.ts` back
      to 0.1.2: unit stayed **fully green**, 3 e2e red — which is the split the
      two suites exist for. (3) `applyColors`/`applyGutterExtension` neutered:
      exactly the 2 settings scenarios red. Pass 2 also exposed Sidetrack #5.
- [x] Design the settings tab → Decision Log #5. Six settings; `''` expresses
      "follow the theme" rather than a stored hex, so a theme switch keeps working.
- [x] Implement the settings tab. `settings.ts` (pure) + `GitGutterSettingTab` in
      `main.ts`; debounce rebuilt on save, colours written as CSS custom properties
      on `<body>`, the gutter toggled by mutating the registered extension array
      and calling `workspace.updateOptions()`.
- [x] Docs. `README.md`: Features, a new § Settings table, Known limitations
      (v0.1 → v0.2, untracked bullet replaced by the buffer-vs-disk caveat),
      Roadmap. `CLAUDE.md`: Release, Architecture (three files + the
      only-`main.ts`-imports-`obsidian` invariant), Conventions, Anti-patterns,
      Known limitations.
- [x] Release `0.2.0` through the documented flow. Tag `0.2.0` → `46115cd`, CI
      green, the draft's three assets byte-identical to the local build
      (`main.js` 9594, `styles.css` 1034, `manifest.json` 310), published:
      https://github.com/VoDmAl/obsidian-git-gutter/releases/tag/0.2.0
      BRAT delivered it to `t23b-content` — `0.1.2 → 0.2.0`, `main.js`
      `4682 → 9594`, matching the release assets. Smoke-tested on the delivered
      build: settings loaded with the right defaults, tab registered, a modified
      note reported `git +64 ~19` with markers painted. The active file was put
      back and the vault's git status is byte-for-byte what it was before.
      Not exercised there: the untracked path — that vault has no untracked
      markdown note, and creating one to probe would write into real content
      (the hermetic e2e suite covers it in this repo's own vault instead).
- [x] Told `t23b-content` via `/vdm:intercom send`
      (`git-gutter-0-2-0-untracked-and-settings`). Leads with the part that
      changes its daily workflow — a brand-new note is untracked, so it now opens
      with the whole gutter green — names the one toggle that switches it off, and
      asks back only for things that can be observed in real use.

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
