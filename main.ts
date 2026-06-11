import {
  Plugin,
  MarkdownView,
  debounce,
  FileSystemAdapter,
  Debouncer,
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

class TypedMarker extends GutterMarker {
  constructor(private readonly type: MarkerType) {
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
});

export default class GitGutterPlugin extends Plugin {
  private refresh!: Debouncer<[], void>;

  override async onload(): Promise<void> {
    this.registerEditorExtension([diffField, diffGutter]);

    this.refresh = debounce(() => void this.refreshActive(), 400, true);

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.refresh()));
    this.registerEvent(this.app.vault.on('modify', () => this.refresh()));

    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  private async refreshActive(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return;
    const cm = (view.editor as unknown as { cm: EditorView }).cm;
    if (!cm) return;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const vaultRoot = adapter.getBasePath();

    const absFile = path.join(vaultRoot, view.file.path);
    const fileDir = path.dirname(absFile);
    const fileName = path.basename(absFile);

    try {
      const { stdout } = await execP(
        `git diff --no-color --unified=0 HEAD -- ${shellQuote(fileName)}`,
        { cwd: fileDir, maxBuffer: 4 * 1024 * 1024, timeout: 5000 }
      );
      const rangeset = parseDiff(stdout, cm.state.doc);
      cm.dispatch({ effects: setDiffEffect.of(rangeset) });
    } catch {
      cm.dispatch({ effects: setDiffEffect.of(RangeSet.empty) });
    }
  }
}

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function parseDiff(diffText: string, doc: Text): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!diffText) return builder.finish();

  const lines = diffText.split('\n');
  let newCursor = 0;
  let pendingRemovals = 0;
  let inHunk = false;
  const marks: { lineNum: number; type: MarkerType }[] = [];

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
  for (const { lineNum, type } of marks) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const pos = doc.line(lineNum).from;
    builder.add(pos, pos, type === 'modified' ? MODIFIED : ADDED);
  }
  return builder.finish();
}
