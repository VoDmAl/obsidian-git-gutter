import {
  Plugin,
  MarkdownView,
  debounce,
  FileSystemAdapter,
  Debouncer,
  setTooltip,
} from 'obsidian';
import {
  StateField,
  StateEffect,
  RangeSet,
  RangeSetBuilder,
  Extension,
  Transaction,
  Text,
} from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execP = promisify(exec);

type MarkerType = 'added' | 'modified';

interface DiffMark {
  lineNum: number;
  type: MarkerType;
}

/** What the status bar has to say about the active file. */
type GutterStatus =
  | { kind: 'changes'; marks: DiffMark[] }
  | { kind: 'clean' }
  | { kind: 'untracked' }
  | { kind: 'unavailable' };

class TypedMarker extends GutterMarker {
  constructor(readonly type: MarkerType) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof TypedMarker && other.type === this.type;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = `git-gutter-marker git-gutter-${this.type}`;
    return el;
  }
}

const ADDED: GutterMarker = new TypedMarker('added');
const MODIFIED: GutterMarker = new TypedMarker('modified');

const setDiffEffect = StateEffect.define<RangeSet<GutterMarker>>();

const diffField = StateField.define<RangeSet<GutterMarker>>({
  create(): RangeSet<GutterMarker> {
    return RangeSet.empty;
  },
  update(value, tr: Transaction): RangeSet<GutterMarker> {
    for (const effect of tr.effects) {
      if (effect.is(setDiffEffect)) return effect.value;
    }
    return value.map(tr.changes);
  },
});

const diffGutter: Extension = gutter({
  class: 'cm-git-gutter',
  markers: (v: EditorView) => v.state.field(diffField, false) ?? RangeSet.empty,
  initialSpacer: () => ADDED,
  // `markers` alone only reaches the line that *starts* a visual block, so a
  // change on any other line of a collapsed block went unmarked. See
  // markerForRange(). No widgetMarker alongside it: Live Preview only produces
  // WidgetRange blocks, which CM still routes through lineMarker, and adding
  // one rendered a second gutter element exactly on top of the first.
  lineMarker: (view, line, others) =>
    others.length > 0 ? null : markerForRange(view, line.from, line.to),
  // A block unfolds when the cursor enters it and folds back when it leaves;
  // that swap does not always change document height, so re-sync on selection.
  lineMarkerChange: (update) => update.selectionSet,
});

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

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Strongest marker among the changed lines inside [from, to], or null.
 *
 * CM6 draws one gutter element per *visual* block and collects only the markers
 * positioned exactly at the block start (`advanceCursor` in @codemirror/view).
 * Obsidian's Live Preview renders raw HTML, tables, callouts and embeds as a
 * single block covering many document lines, so every change below that block's
 * first line was dropped — invisibly, since a missing marker looks exactly like
 * an unchanged file — until the cursor entered the block and it fell back to
 * source. Folding the block's whole range into one marker is what keeps those
 * changes visible; the marker then spans the rendered block's full height.
 */
function markerForRange(view: EditorView, from: number, to: number): GutterMarker | null {
  const set = view.state.field(diffField, false);
  if (!set) return null;

  // Boxed: TypeScript does not track assignments made inside the callback.
  const found: { type: MarkerType | null } = { type: null };
  set.between(from, to, (_from, _to, marker) => {
    if (!(marker instanceof TypedMarker)) return undefined;
    if (marker.type === 'modified') {
      found.type = 'modified';
      return false; // modified wins over added — nothing left to learn
    }
    if (found.type === null) found.type = 'added';
    return undefined;
  });

  if (found.type === 'modified') return MODIFIED;
  if (found.type === 'added') return ADDED;
  return null;
}

function parseDiff(diffText: string): DiffMark[] {
  const marks: DiffMark[] = [];
  if (!diffText) return marks;

  const lines = diffText.split('\n');
  let newCursor = 0;
  let pendingRemovals = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newCursor = parseInt(hunk[1], 10);
      pendingRemovals = 0;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;

    if (line.startsWith('+')) {
      const type: MarkerType = pendingRemovals > 0 ? 'modified' : 'added';
      marks.push({ lineNum: newCursor, type });
      if (pendingRemovals > 0) pendingRemovals--;
      newCursor++;
    } else if (line.startsWith('-')) {
      pendingRemovals++;
    } else {
      newCursor++;
      pendingRemovals = 0;
    }
  }

  marks.sort((a, b) => a.lineNum - b.lineNum);
  return marks;
}

function buildMarkers(marks: DiffMark[], doc: Text): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const { lineNum, type } of marks) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const pos = doc.line(lineNum).from;
    builder.add(pos, pos, type === 'modified' ? MODIFIED : ADDED);
  }
  return builder.finish();
}
