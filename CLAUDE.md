# obsidian-git-gutter

VS Code-style gutter markers for uncommitted lines (added/modified vs HEAD) in Obsidian. Distributed via BRAT — see [README.md](README.md) for user-facing docs.

This file = Claude Code session orientation (build/release/architecture). README = end-user docs.

## Build

- `npm install` — installs devDeps. Requires `legacy-peer-deps` (`.npmrc` enforces). Reason: `obsidian@1.13+` pins `@codemirror/state@6.5.0` (exact peer), but `@codemirror/view@6.43+` brings `@codemirror/state@^6.6.0` — known upstream peer mismatch. `--legacy-peer-deps` lets npm pick a working tree.
- `npm run dev` — esbuild watch mode. Rebuilds `main.js` on every save of `main.ts`. Use when dogfooding via symlink into a vault.
- `npm run build` — production: `tsc -noEmit -skipLibCheck` (typecheck only — esbuild does the actual emit) + `node esbuild.config.mjs production` (minified bundle).

Build artifact `main.js` is gitignored — published only via GitHub Releases (see § Release).

## Release

1. Bump `manifest.json#version`. Add the new version → `minAppVersion` mapping to `versions.json`.
   - Shortcut: `npm version <semver> --no-git-tag-version` triggers `version-bump.mjs` which does both. `--no-git-tag-version` is required: plain `npm version` commits and tags on its own, and its tag carries a `v` prefix that the release workflow does not match. `scripts.version` stages only `manifest.json` + `versions.json` — stage `package.json` and `package-lock.json` yourself, then commit.
2. `git tag <version>` — tag name MUST match `manifest.json#version` exactly. No `v` prefix.
3. `git push origin main && git push origin <version>` — the tag triggers `.github/workflows/release.yml`:
   - `npm ci` (legacy-peer-deps via .npmrc)
   - `npm run build`
   - `gh release create <tag> --draft main.js manifest.json styles.css`
4. Wait for CI, then sanity-check the draft's 3 assets against the local build:
   ```
   gh run watch "$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
   gh release view <tag> --json isDraft,assets -q '(.assets[] | "\(.name) \(.size)")'
   ```
   Byte sizes must match `wc -c main.js styles.css manifest.json`. The draft step is deliberate — it is the chance to abort if CI produced something unexpected — but it is a check, not a trip to the browser.
5. `gh release edit <tag> --draft=false` — publishes. **Do not** publish with a local `gh release create` instead: a tag created through the API by your own token still fires `on: push: tags`, so the workflow runs and fails on a release that already exists, and the assets would come from the local worktree rather than clean CI.
6. BRAT clients pick up the new release on next refresh, or force it with `obsidian command id=obsidian42-brat:checkForUpdatesAndUpdate` (the `id=` prefix is required). Verify by re-reading the installed `manifest.json` version and `main.js` byte count under `<vault>/.obsidian/plugins/git-gutter/`.

Marketplace submission (PR to `obsidianmd/obsidian-releases`) is deferred until v0.2+ closes the obvious gaps (untracked files, reading mode). Don't submit at v0.1 — high chance of bounce-back.

## Architecture

- **`main.ts`** = the Obsidian layer: `GitGutterPlugin extends Plugin`, refresh wiring, `git` invocation, status bar.
- **`diff.ts`** = the CodeMirror layer: diff parsing, marker types, the `StateField`, the gutter extension. It imports nothing from `obsidian`, which is what makes it runnable — and testable — outside the app.
- **`diffField` (CodeMirror 6 `StateField`)** holds per-editor `RangeSet<GutterMarker>` of changed lines. Updated via `setDiffEffect` transactions. Auto-remaps existing ranges on user edits via `value.map(tr.changes)`.
- **`diffGutter` (CM6 `gutter()` extension)** reads `diffField` and renders markers in a 3px left gutter (see `styles.css`).
- **Live Preview blocks**: CM6's `gutter()` collects only the markers sitting exactly at a visual block's start, and Live Preview renders raw HTML / tables / callouts as one block spanning many document lines — so every change below such a block's first line was invisible. `lineMarker` folds the block's whole range into a single marker (`markerForRange`); `lineMarkerChange: update.selectionSet` re-syncs when a block folds/unfolds.
- **Status bar** (`showStatus`): four states that must stay distinguishable — `+N ~M` (changes), `±0` (tracked, clean), `untracked`, `—` (no diff at all); hidden when no markdown editor is active. It exists because an empty gutter has four causes that look identical, which is how the Live Preview bug above stayed invisible. Collapsing any two states re-creates that defect. Counts come from the parsed diff, not from the rendered markers, so they stay honest even if rendering breaks again.
- **Refresh triggers**: `active-leaf-change`, `editor-change`, vault `modify`, `onLayoutReady`. Debounced 400 ms (`debounce(fn, 400, true)` — leading edge, restarts on each call).
- **Git invocation**: `git diff --no-color --unified=0 HEAD -- <basename>` with `cwd = path.dirname(absFile)`. Letting git auto-discover the containing repo this way is critical — supports sub-project git repos inside a vault, not only vault-root repo. 5 s timeout. Any error (no git on PATH, not a repo, etc.) → silent clear of gutter.
- **Hunk parser** (`parseDiff`): tracks `+`/`-`/context lines. `+` after `-` in same hunk = `modified` (yellow); pure `+` = `added` (green). Lines are 1-indexed (matches git diff output and CM6 `doc.line()`).

## Conventions

- TypeScript with `strictNullChecks: true`. No `any` for plugin-owned code (Obsidian's editor.cm cast through `unknown` is the one allowed escape hatch — Obsidian doesn't expose `cm: EditorView` in its public types).
- esbuild externals: `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, Node builtins. Obsidian provides these at runtime.
- Output: CJS bundle to `main.js` (Obsidian loads plugins via `require()`).
- `npm test` — `node --test` over `tests/*.test.ts`. No test framework and no build step: node strips the types and runs the sources directly, which is why `diff.ts` must stay free of `obsidian` imports and of non-erasable TypeScript (no parameter properties, no enums), and why its imports separate `import type` from value imports. CI runs it before the build, so a red test blocks a release.
- `npm run test:e2e` — the other half, against a **running Obsidian** through the `obsidian` CLI: whether CodeMirror actually paints a marker where it was asked, what Live Preview does to the block structure, what the status bar says. Unit tests cannot see any of that, and the collapsed-block bug lived entirely there. Not runnable in CI (needs a desktop app and an open vault), so it is a local gate, not an automatic one.
- The e2e vault is **this repository itself** — `.obsidian/` sits at the repo root and the fixture note lives at `tests/e2e/fixtures/collapsed-block.md`. One directory serves git and Obsidian, so the fixture is already tracked (there is something to diff against), the edits land on files that go through review, and the plugin's own "run git from the file's directory" logic finds this repo. `userIgnoreFilters` hides `node_modules/` (938 files — small enough that indexing it costs nothing, but it has no business in the file explorer).
- The committed vault config is deliberately minimal: `app.json` (which pins Live Preview — every interesting case disappears in Source mode) and `community-plugins.json`. Everything Obsidian writes per-machine — `workspace.json`, `appearance.json`, `core-plugins.json`, `plugins/` — is gitignored.
- **One-time setup:** Obsidian only opens a folder it already knows, so `obsidian://open?path=…` fails with *Unable to find a vault for the URL* until the repo has been opened once through Obsidian → Open folder as vault. The suite tries the URI, waits, and skips with that instruction rather than failing.
- The suite installs the working-tree build into `.obsidian/plugins/git-gutter` (also `npm run vault:install`), edits the fixture **on disk** rather than through the editor — which is how the plugin is actually used — and restores the file and the untracked probe in `after`, including when a test fails. Lines are addressed by the sentence they contain, not by number, so editing the fixture's prose cannot silently re-point an assertion.
- Scenarios that do not depend on the fixture's git state (the block structure, the untracked probe) still run when the fixture is uncommitted; the ones that diff against HEAD skip with the reason.
- Both suites were checked against the bug they describe: revert the fix, watch exactly those tests go red, restore. A test that has never failed proves nothing.

## Dogfooding (local development)

The repo is its own vault, so there is no external test vault to wire up. Open this
folder in Obsidian once (Open folder as vault) and the plugin marks the repo's own
uncommitted work — edit `README.md` or `CLAUDE.md` and the gutter shows what changed
since HEAD, before anything is committed.

```bash
npm run dev            # esbuild watch, rebuilds main.js on save
npm run vault:install  # copy main.js + manifest.json + styles.css into .obsidian/plugins/git-gutter
```

After code changes are bundled to `main.js` (esbuild prints `✔ done`), re-run
`vault:install` and reload the plugin via Obsidian CLI:

```bash
obsidian vault=obsidian-git-gutter plugin:reload id=git-gutter
```

Or `Cmd+R` to reload the whole vault.

## Known limitations / roadmap

See [README.md](README.md) §§ Known limitations + Roadmap. Short version:

- v0.1 → untracked files: no markers. Fix candidate: pre-check `git ls-files --others --exclude-standard`.
- v0.1 → reading mode: no gutter (Obsidian reading view doesn't use CodeMirror).
- v0.1 → side panes lag refresh (only active leaf triggers re-diff).
- v0.1 → on-disk vs buffer: `git diff` reads disk, not unsaved buffer. Obsidian autosave masks this in practice.

## Reference

- Obsidian plugin template + dev docs: https://github.com/obsidianmd/obsidian-sample-plugin
- BRAT distribution: https://github.com/TfTHacker/obsidian42-brat
- CodeMirror 6 reference: https://codemirror.net/docs/
- Obsidian plugin API: https://docs.obsidian.md/Reference/TypeScript+API/

## Anti-patterns

- **Don't add Reading-mode support via markdown post-processor unless line mapping is solved.** Markdown rendering collapses/expands lines (callouts, embeds, lists with nested content) — naive line→line mapping from source to rendered HTML produces wrong gutter positions. If pursued in v0.4, requires careful index tracking through the post-processor pipeline.
- **Don't poll git on a timer.** Refresh is event-driven (active leaf change, edit, save). Adding a setInterval defeats debouncing and burns CPU on idle vaults.
- **Don't shell out without quoting.** `shellQuote()` in main.ts wraps the basename for safety. If you add new git invocations, route through the same helper or use child_process spawn with arg array.
- **Don't add `widgetMarker` next to `lineMarker`.** Obsidian's Live Preview only produces `WidgetRange` blocks, which CM still routes through `lineMarker`; declaring both renders two gutter elements stacked exactly on top of each other for every changed block (verified in-app, 2026-09-17).
- **Don't commit `main.js`.** Build artifact only. GitHub Release is the distribution channel; tracking it in source would defeat the release workflow and double-source-of-truth.
