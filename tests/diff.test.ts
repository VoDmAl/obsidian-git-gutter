import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  buildMarkers,
  diffField,
  markerForRange,
  parseDiff,
  setDiffEffect,
  shellQuote,
  type DiffMark,
} from '../diff.ts';

/** `parseDiff` output as `["3+", "7~"]` — compact enough to read a whole case at a glance. */
function marks(diff: string): string[] {
  return parseDiff(diff).map((m: DiffMark) => `${m.lineNum}${m.type === 'modified' ? '~' : '+'}`);
}

test('no diff output means no marks', () => {
  assert.deepEqual(marks(''), []);
  assert.deepEqual(marks('\n'), []);
});

test('lines before the first hunk header are not content', () => {
  const diff = [
    'diff --git a/note.md b/note.md',
    'index 18efa90..f82a771 100644',
    '--- a/note.md',
    '+++ b/note.md',
    '@@ -0,0 +1 @@',
    '+hello',
  ].join('\n');
  assert.deepEqual(marks(diff), ['1+']);
});

test('a pure insertion is added, a replaced line is modified', () => {
  assert.deepEqual(marks('@@ -0,0 +4 @@\n+new line'), ['4+']);
  assert.deepEqual(marks('@@ -4 +4 @@\n-old line\n+new line'), ['4~']);
});

test('extra additions past the removed count are added, not modified', () => {
  // One line replaced by three: the first pairs with the removal, the rest are new.
  const diff = '@@ -4 +4,3 @@\n-old\n+one\n+two\n+three';
  assert.deepEqual(marks(diff), ['4~', '5+', '6+']);
});

test('removals with no additions leave no marks', () => {
  assert.deepEqual(marks('@@ -4,2 +3,0 @@\n-gone\n-also gone'), []);
});

test('every hunk restarts line numbering from its own header', () => {
  const diff = [
    '@@ -10 +10 @@',
    '-old',
    '+new',
    '@@ -50,0 +51,2 @@',
    '+added one',
    '+added two',
  ].join('\n');
  assert.deepEqual(marks(diff), ['10~', '51+', '52+']);
});

test('marks come back sorted by line number', () => {
  const diff = '@@ -80,0 +81 @@\n+late\n@@ -5 +5 @@\n-old\n+early';
  assert.deepEqual(marks(diff), ['5~', '81+']);
});

// --- content that looks like diff syntax -------------------------------------
// Obsidian notes open with `---` frontmatter fences, so a removed `---` arrives
// as `----` and an added one as `+---`. Treating those as file headers loses the
// removal, and the replacement line is then mis-coloured green instead of yellow.

test('a changed frontmatter fence is modified, not added', () => {
  assert.deepEqual(marks('@@ -1 +1 @@\n----\n+---'), ['1~']);
});

test('an added line starting with ++ is not mistaken for a file header', () => {
  assert.deepEqual(marks('@@ -0,0 +2 @@\n+++highlight++'), ['2+']);
});

test('"no newline at end of file" does not shift the lines after it', () => {
  // git emits the annotation after both sides of the last line. Counting it as a
  // context line would push the `+` onto line 11 and call it added.
  const diff = [
    '@@ -10 +10 @@',
    '-old last line',
    '\\ No newline at end of file',
    '+new last line',
    '\\ No newline at end of file',
  ].join('\n');
  assert.deepEqual(marks(diff), ['10~']);
});

// --- document mapping --------------------------------------------------------

function docOf(lines: number): EditorState {
  return EditorState.create({
    doc: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'),
    extensions: [diffField],
  });
}

test('markers land on the first position of their line', () => {
  const state = docOf(3);
  const set = buildMarkers(parseDiff('@@ -0,0 +2 @@\n+x'), state.doc);
  const found: number[] = [];
  set.between(0, state.doc.length, (from) => {
    found.push(from);
  });
  assert.deepEqual(found, [state.doc.line(2).from]);
});

test('marks beyond the end of the buffer are dropped rather than throwing', () => {
  // The diff reads the file on disk; the buffer can be shorter.
  const state = docOf(2);
  const set = buildMarkers(parseDiff('@@ -0,0 +9 @@\n+past the end'), state.doc);
  let count = 0;
  set.between(0, state.doc.length, () => {
    count++;
  });
  assert.equal(count, 0);
});

// --- markerForRange: the collapsed-block regression --------------------------

function viewWith(state: EditorState, diff: string): EditorView {
  const next = state.update({
    effects: setDiffEffect.of(buildMarkers(parseDiff(diff), state.doc)),
  }).state;
  // markerForRange only ever reads `view.state`.
  return { state: next } as unknown as EditorView;
}

test('a range covering a changed line reports that line', () => {
  const state = docOf(10);
  const view = viewWith(state, '@@ -0,0 +5 @@\n+x');
  const line = state.doc.line(5);
  assert.ok(markerForRange(view, line.from, line.to));
});

test('a range whose changed line is NOT its first line still reports', () => {
  // Live Preview collapses lines 3..7 into one block; the change is on line 5.
  // Before the fix this returned null and the change was invisible.
  const state = docOf(10);
  const view = viewWith(state, '@@ -5 +5 @@\n-old\n+new');
  const from = state.doc.line(3).from;
  const to = state.doc.line(7).to;
  const marker = markerForRange(view, from, to);
  assert.ok(marker, 'a change inside the block must produce a marker');
});

test('a range with no changed line reports nothing', () => {
  const state = docOf(10);
  const view = viewWith(state, '@@ -0,0 +9 @@\n+x');
  const from = state.doc.line(2).from;
  const to = state.doc.line(4).to;
  assert.equal(markerForRange(view, from, to), null);
});

test('modified outranks added when a block holds both', () => {
  const state = docOf(10);
  const added = viewWith(state, '@@ -0,0 +3,2 @@\n+a\n+b');
  const mixed = viewWith(state, '@@ -0,0 +3 @@\n+a\n@@ -4 +4 @@\n-old\n+new');
  const from = state.doc.line(3).from;
  const to = state.doc.line(4).to;
  const addedMarker = markerForRange(added, from, to);
  const mixedMarker = markerForRange(mixed, from, to);
  assert.ok(addedMarker && mixedMarker);
  // The marker paints its class in toDOM(), so compare through GutterMarker.eq —
  // TypedMarker.eq is exactly "same kind of change".
  assert.ok(!addedMarker!.eq(mixedMarker!), 'a block with a modified line must not paint as added');
});

test('an editor without the field is tolerated', () => {
  const bare = EditorState.create({ doc: 'x' });
  const view = { state: bare } as unknown as EditorView;
  assert.equal(markerForRange(view, 0, 1), null);
});

// --- shell quoting -----------------------------------------------------------

test('file names are wrapped so the shell cannot read them as syntax', () => {
  assert.equal(shellQuote('note.md'), "'note.md'");
  assert.equal(shellQuote('my note.md'), "'my note.md'");
  assert.equal(shellQuote('a;rm -rf b.md'), "'a;rm -rf b.md'");
  assert.equal(shellQuote("it's.md"), "'it'\\''s.md'");
});
