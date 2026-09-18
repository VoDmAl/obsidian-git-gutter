import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEBOUNCE_MAX,
  DEBOUNCE_MIN,
  DEFAULT_SETTINGS,
  clampDebounce,
  isValidColor,
  normalizeSettings,
} from '../settings.ts';

// `loadData()` returns whatever is in `data.json`, and that file sits inside a
// git repository the user is already looking at — hand-editing it is a normal
// thing for this audience to do. So every field arrives untrusted.

test('a vault that never saved settings gets the defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test('settings saved by an older version keep their values and gain the new ones', () => {
  // A 0.2.0 data.json that predates a later field must not lose what it has.
  const stored = normalizeSettings({ debounceMs: 900, markUntracked: false });
  assert.equal(stored.debounceMs, 900);
  assert.equal(stored.markUntracked, false);
  assert.equal(stored.enabled, DEFAULT_SETTINGS.enabled);
  assert.equal(stored.showStatusBar, DEFAULT_SETTINGS.showStatusBar);
});

test('a non-boolean toggle falls back to its default rather than going falsy', () => {
  // `enabled: 0` read as a boolean would silently disable the whole plugin.
  const s = normalizeSettings({ enabled: 0, showStatusBar: 'yes', markUntracked: null });
  assert.equal(s.enabled, true);
  assert.equal(s.showStatusBar, true);
  assert.equal(s.markUntracked, true);
});

// --- debounce ----------------------------------------------------------------

test('the refresh delay is clamped to a range that stays usable', () => {
  // 0 would shell out to git on every keystroke; a minute would look broken.
  assert.equal(clampDebounce(0), DEBOUNCE_MIN);
  assert.equal(clampDebounce(-500), DEBOUNCE_MIN);
  assert.equal(clampDebounce(60_000), DEBOUNCE_MAX);
  assert.equal(clampDebounce(400), 400);
});

test('a delay that is not a number at all becomes the default', () => {
  assert.equal(clampDebounce('soon'), DEFAULT_SETTINGS.debounceMs);
  assert.equal(clampDebounce(NaN), DEFAULT_SETTINGS.debounceMs);
  assert.equal(clampDebounce(Infinity), DEFAULT_SETTINGS.debounceMs);
  assert.equal(clampDebounce(null), DEFAULT_SETTINGS.debounceMs);
});

test('a numeric string delay is honoured, not discarded', () => {
  // JSON hand-edited to "600" is unambiguous about what was meant.
  assert.equal(clampDebounce('600'), 600);
  assert.equal(clampDebounce(612.4), 612);
});

// --- colours -----------------------------------------------------------------
// The chosen colour becomes a CSS custom property that styles.css reads through
// var(). Custom properties swallow almost any token, so junk does not fail at
// assignment — it fails at `background: var(--git-gutter-added)`, which drops
// the declaration and paints nothing. An invisible gutter is the exact failure
// this plugin exists to prevent, so the value is validated before it is stored.

test('hex colours in both lengths are accepted', () => {
  assert.ok(isValidColor('#4caf50'));
  assert.ok(isValidColor('#FFB300'));
  assert.ok(isValidColor('#0a0'));
});

test('anything that would make the marker invisible is rejected', () => {
  assert.ok(!isValidColor('red'));
  assert.ok(!isValidColor('#12345'));
  assert.ok(!isValidColor('rgb(1,2,3)'));
  assert.ok(!isValidColor('#ffffff; background: url(x)'));
  assert.ok(!isValidColor(0x4caf50));
  assert.ok(!isValidColor(''));
});

test('a rejected colour falls back to the theme rather than to nothing', () => {
  const s = normalizeSettings({ addedColor: 'chartreuse', modifiedColor: '#ffb300' });
  assert.equal(s.addedColor, '', 'an unusable colour must leave the theme in charge');
  assert.equal(s.modifiedColor, '#ffb300');
});

test('the empty colour is a valid stored value, not a rejected one', () => {
  // '' is how "follow the theme" is expressed, which is also the default.
  assert.equal(normalizeSettings({ addedColor: '' }).addedColor, '');
  assert.equal(DEFAULT_SETTINGS.addedColor, '');
  assert.equal(DEFAULT_SETTINGS.modifiedColor, '');
});

test('normalizing is idempotent', () => {
  // saveData writes back what normalizeSettings produced, and the next load
  // normalizes it again; a round trip that changed anything would drift.
  const once = normalizeSettings({ debounceMs: 1234.6, addedColor: 'nope', enabled: 'x' });
  assert.deepEqual(normalizeSettings(once), once);
});
