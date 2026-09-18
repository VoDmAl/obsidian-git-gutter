import {
  Plugin,
  MarkdownView,
  debounce,
  FileSystemAdapter,
  Debouncer,
  setTooltip,
} from 'obsidian';
import { RangeSet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  DiffMark,
  GutterStatus,
  buildMarkers,
  diffField,
  diffGutter,
  parseDiff,
  setDiffEffect,
  shellQuote,
} from './diff.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execP = promisify(exec);

export default class GitGutterPlugin extends Plugin {
  private refresh!: Debouncer<[], void>;
  private status!: HTMLElement;

  override async onload(): Promise<void> {
    this.registerEditorExtension([diffField, diffGutter]);

    this.status = this.addStatusBarItem();
    this.status.addClass('git-gutter-status');
    this.hideStatus();

    this.refresh = debounce(() => void this.refreshActive(), 400, true);

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.refresh()));
    this.registerEvent(this.app.vault.on('modify', () => this.refresh()));

    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  private async refreshActive(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return this.hideStatus();
    const cm = (view.editor as unknown as { cm: EditorView }).cm;
    if (!cm) return this.hideStatus();

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return this.hideStatus();
    const vaultRoot = adapter.getBasePath();

    const absFile = path.join(vaultRoot, view.file.path);
    const fileDir = path.dirname(absFile);
    const fileName = path.basename(absFile);

    try {
      const { stdout } = await execP(
        `git diff --no-color --unified=0 HEAD -- ${shellQuote(fileName)}`,
        { cwd: fileDir, maxBuffer: 4 * 1024 * 1024, timeout: 5000 }
      );
      const marks = parseDiff(stdout);
      cm.dispatch({ effects: setDiffEffect.of(buildMarkers(marks, cm.state.doc)) });

      if (marks.length > 0) {
        this.showStatus({ kind: 'changes', marks });
      } else {
        // An untracked file yields an empty diff and exit 0, exactly like a clean
        // one. Reporting it as "no changes" would be the very lie this counter
        // exists to prevent, so the empty case costs one extra git call.
        const tracked = await isTracked(fileDir, fileName);
        this.showStatus({ kind: tracked ? 'clean' : 'untracked' });
      }
    } catch {
      // No git on PATH, not a repository, no HEAD yet, timeout.
      cm.dispatch({ effects: setDiffEffect.of(RangeSet.empty) });
      this.showStatus({ kind: 'unavailable' });
    }
  }

  /**
   * An empty gutter means "nothing changed", "this file was never tracked" or
   * "the diff never arrived" — and all three look identical, which is how a
   * whole class of changes stayed invisible (see CLAUDE.md § Live Preview
   * blocks). The status bar names which one it is, so a silent miss stops being
   * silent. Every state that is not `changes` must therefore stay
   * distinguishable; collapsing any two of them re-creates the original defect.
   *
   * Counts come from the diff, so they can exceed the number of markers drawn
   * when the buffer holds unsaved lines the file on disk does not
   * (README § Known limitations).
   */
  private showStatus(status: GutterStatus): void {
    const el = this.status;
    el.style.display = '';
    el.empty();
    el.createSpan({ text: 'git' });

    if (status.kind === 'unavailable') {
      el.createSpan({ text: '—' });
      setTooltip(el, 'Git Gutter: no diff — not inside a git repository, or git is unavailable');
      return;
    }

    if (status.kind === 'untracked') {
      el.createSpan({ text: 'untracked' });
      setTooltip(el, 'Git Gutter: file is not tracked by git — nothing to compare against, so no markers');
      return;
    }

    if (status.kind === 'clean') {
      el.createSpan({ text: '±0' });
      setTooltip(el, 'Git Gutter: no uncommitted changes vs HEAD');
      return;
    }

    const modified = status.marks.filter((m) => m.type === 'modified').length;
    const added = status.marks.length - modified;
    if (added > 0) el.createSpan({ cls: 'git-gutter-status-added', text: `+${added}` });
    if (modified > 0) el.createSpan({ cls: 'git-gutter-status-modified', text: `~${modified}` });
    setTooltip(el, `Git Gutter: ${added} added, ${modified} modified lines vs HEAD`);
  }

  private hideStatus(): void {
    this.status.style.display = 'none';
  }
}

async function isTracked(cwd: string, fileName: string): Promise<boolean> {
  try {
    await execP(`git ls-files --error-unmatch -- ${shellQuote(fileName)}`, { cwd, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
