# Obsidian Git Gutter

VS Code-style gutter markers for uncommitted lines in [Obsidian](https://obsidian.md). Highlights lines that are **added** or **modified** vs the latest `HEAD` commit, directly in the editor.

For anyone who keeps their markdown notes in a git repository — workspaces, code-adjacent docs, multi-author vaults — and wants visual cues about what changed since the last commit, without leaving Obsidian.

## Features

- **Gutter markers** — thin coloured bar to the left of changed lines.
  - 🟢 Green — added (no prior line in this hunk).
  - 🟡 Yellow — modified (`+` line followed a `-` line in the same hunk).
- **Auto-refresh** — on file open, on editor change, on save (debounced 400 ms).
- **Multi-repo** — works wherever `git diff HEAD` works. The plugin runs `git` from the file's own directory, so any sub-project git repo inside your vault is detected automatically — no global config.
- **Edit mode + Live Preview** — both CodeMirror 6 surfaces are covered.

## Install via BRAT (recommended)

While this plugin is awaiting submission to the Obsidian community plugin marketplace, you can install it via [BRAT (Beta Reviewers Auto-update Tool)](https://github.com/TfTHacker/obsidian42-brat).

1. In Obsidian → **Settings → Community plugins → Browse** → search for **BRAT**, install and enable it.
2. Open BRAT settings → **Add Beta Plugin** → paste `vodmal/obsidian-git-gutter` → click **Add Plugin**.
3. BRAT downloads the latest GitHub release and installs it as `git-gutter` under `.obsidian/plugins/`.
4. **Settings → Community plugins** → enable **Git Gutter**.

BRAT keeps the plugin up-to-date automatically when new GitHub releases are tagged.

## Install manually

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/vodmal/obsidian-git-gutter/releases).
2. Drop them into `<vault>/.obsidian/plugins/git-gutter/` (create the folder).
3. **Settings → Community plugins** → reload list, enable **Git Gutter**.

## How it works

- A CodeMirror 6 `StateField` holds a `RangeSet<GutterMarker>` per editor.
- On refresh events, the plugin runs `git diff --no-color --unified=0 HEAD -- <basename>` with `cwd = directory(file)` and parses the hunks.
- Hunk parser tracks `+` lines (added/modified) and `-` lines (deletions; modified flag if followed by `+`).
- The resulting `RangeSet` is dispatched via a `StateEffect`. CM6 paints the gutter on next render.

`git` is invoked as a subprocess with a 5 s timeout. If `git` is not on `PATH`, the file is not in a repo, or the command fails for any other reason, the gutter is silently cleared.

## Known limitations (v0.1)

- **Untracked files** show no markers. `git diff HEAD` produces no output for files that have never been `git add`-ed. Fix candidate: pre-check via `git ls-files --others --exclude-standard <file>` and mark every line as added.
- **Reading mode** has no gutter. Obsidian's reading view does not use CodeMirror, so the same extension cannot decorate it. Edit mode and Live Preview are covered.
- **Side panes** that are not the active leaf show the last-painted gutter; the refresh hooks watch the active leaf only. Switching panes re-fires refresh, so the lag is brief.
- **On-disk vs buffer** — `git diff` compares the file on disk to HEAD, not your live editor buffer. Obsidian's autosave is frequent enough that this is barely noticeable in practice.
- **Desktop only** (`isDesktopOnly: true` in manifest). Mobile Obsidian has no `child_process` access.

## Roadmap

- `v0.2` — untracked-file detection (mark whole file as added).
- `v0.2` — settings tab (colour customisation, debounce interval, on/off per vault).
- `v0.3` — gutter hover popover showing the diff hunk for that line.
- `v0.4` — reading-mode markers via markdown post-processor (approximation; line mapping is lossier in rendered HTML).
- Maybe — comparison base configurable (HEAD vs index, HEAD vs `origin/main`, etc.).

## Development

```bash
git clone https://github.com/vodmal/obsidian-git-gutter
cd obsidian-git-gutter
npm install
npm run dev      # esbuild --watch, rebuilds main.js on every save
npm run build    # production build
```

To dogfood locally without publishing a release, symlink the build into a vault:

```bash
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/git-gutter
```

Then reload the vault (or run `obsidian plugin:reload id=git-gutter` via the [Obsidian CLI](https://github.com/Vinzent03/obsidian-cli)).

## Releasing

1. Bump version in `manifest.json` and add an entry to `versions.json` mapping the new plugin version to the `minAppVersion`.
2. `git tag <version>` — the tag name must match `manifest.json#version` exactly (no `v` prefix).
3. `git push origin <version>` — the GitHub Actions workflow at `.github/workflows/release.yml` builds the plugin and uploads `main.js`, `manifest.json`, `styles.css` to the release.
4. BRAT users will pick up the new release on next refresh.

## License

[MIT](LICENSE) © Dmitry Vorobyev
