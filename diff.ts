// Values and types are imported separately: `node --test` strips types instead
// of compiling, so a type-only name left in a value import survives to runtime
// and fails to resolve.
import { StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
import type { Extension, Transaction, Text } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';

export type MarkerType = 'added' | 'modified';

export interface DiffMark {
  lineNum: number;
  type: MarkerType;
}

/** What the status bar has to say about the active file. */
export type GutterStatus =
  | { kind: 'changes'; marks: DiffMark[] }
  | { kind: 'clean' }
  | { kind: 'untracked' }
  | { kind: 'unavailable' };

class TypedMarker extends GutterMarker {
  // Plain field, not a parameter property: `node --test` strips types rather
  // than compiling them, and parameter properties are not erasable syntax.
  readonly type: MarkerType;

  constructor(type: MarkerType) {
    super();
    this.type = type;
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

export const setDiffEffect = StateEffect.define<RangeSet<GutterMarker>>();

export const diffField = StateField.define<RangeSet<GutterMarker>>({
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

export const diffGutter: Extension = gutter({
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

export function shellQuote(s: string): string {
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
export function markerForRange(view: EditorView, from: number, to: number): GutterMarker | null {
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

export function parseDiff(diffText: string): DiffMark[] {
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
    // A second file's header would end this file's hunks. We only ever diff one
    // file, but the guard costs a line and removes the whole failure mode.
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    // "\\ No newline at end of file" annotates the line above; counting it as
    // context shifts every following line number and loses the `-`/`+` pairing
    // that marks a line modified rather than added.
    if (line.startsWith('\\')) continue;

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

export function buildMarkers(marks: DiffMark[], doc: Text): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const { lineNum, type } of marks) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const pos = doc.line(lineNum).from;
    builder.add(pos, pos, type === 'modified' ? MODIFIED : ADDED);
  }
  return builder.finish();
}
