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
   - Shortcut: `npm version <semver>` triggers `version-bump.mjs` which does both. Don't forget to commit afterwards (`scripts.version` only stages, doesn't commit).
2. `git tag <version>` — tag name MUST match `manifest.json#version` exactly. No `v` prefix.
3. `git push origin <version>` — triggers `.github/workflows/release.yml`:
   - `npm ci` (legacy-peer-deps via .npmrc)
   - `npm run build`
   - `gh release create <tag> --draft main.js manifest.json styles.css`
4. Open the draft release on GitHub → sanity-check the 3 attached assets → **Publish**. The draft step is deliberate: gives a chance to abort if something went wrong in CI.
5. BRAT clients pick up new release on next refresh (or via BRAT settings → check for updates).

Marketplace submission (PR to `obsidianmd/obsidian-releases`) is deferred until v0.2+ closes the obvious gaps (untracked files, reading mode). Don't submit at v0.1 — high chance of bounce-back.

## Architecture

- **`main.ts`** = entire plugin. Single class `GitGutterPlugin extends Plugin`.
- **`diffField` (CodeMirror 6 `StateField`)** holds per-editor `RangeSet<GutterMarker>` of changed lines. Updated via `setDiffEffect` transactions. Auto-remaps existing ranges on user edits via `value.map(tr.changes)`.
- **`diffGutter` (CM6 `gutter()` extension)** reads `diffField` and renders markers in a 3px left gutter (see `styles.css`).
- **Refresh triggers**: `active-leaf-change`, `editor-change`, vault `modify`, `onLayoutReady`. Debounced 400 ms (`debounce(fn, 400, true)` — leading edge, restarts on each call).
- **Git invocation**: `git diff --no-color --unified=0 HEAD -- <basename>` with `cwd = path.dirname(absFile)`. Letting git auto-discover the containing repo this way is critical — supports sub-project git repos inside a vault, not only vault-root repo. 5 s timeout. Any error (no git on PATH, not a repo, etc.) → silent clear of gutter.
- **Hunk parser** (`parseDiff`): tracks `+`/`-`/context lines. `+` after `-` in same hunk = `modified` (yellow); pure `+` = `added` (green). Lines are 1-indexed (matches git diff output and CM6 `doc.line()`).

## Conventions

- TypeScript with `strictNullChecks: true`. No `any` for plugin-owned code (Obsidian's editor.cm cast through `unknown` is the one allowed escape hatch — Obsidian doesn't expose `cm: EditorView` in its public types).
- esbuild externals: `obsidian`, `electron`, all `@codemirror/*`, all `@lezer/*`, Node builtins. Obsidian provides these at runtime.
- Output: CJS bundle to `main.js` (Obsidian loads plugins via `require()`).
- No automated tests yet. Verification = symlink the repo into a test vault, reload Obsidian, edit a tracked `.md`, observe gutter.

## Dogfooding (local development)

Fastest loop is `npm run dev` (esbuild watch) + symlink:

```bash
ln -s "$(pwd)" /path/to/test-vault/.obsidian/plugins/git-gutter
```

Then in Obsidian: Settings → Community plugins → enable `git-gutter`. After code changes are bundled to `main.js` (esbuild prints `✔ done`), reload the plugin via Obsidian CLI:

```bash
obsidian plugin:reload id=git-gutter
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
- **Don't commit `main.js`.** Build artifact only. GitHub Release is the distribution channel; tracking it in source would defeat the release workflow and double-source-of-truth.
