/**
 * The settings' *pure* half: shape, defaults, validation.
 *
 * Deliberately free of `obsidian` imports, for the same reason `diff.ts` is —
 * `node --test` strips types and runs these sources directly, so anything that
 * reaches for the Obsidian runtime cannot be tested. The `PluginSettingTab`
 * that renders these values lives in `main.ts`, which is the only file allowed
 * to import `obsidian`.
 */

export interface GitGutterSettings {
  /** Master switch. Off removes the CM extensions entirely — no gutter, no git calls. */
  enabled: boolean;
  /** The four-state counter in the status bar. */
  showStatusBar: boolean;
  /** Mark every line of an untracked file as added. */
  markUntracked: boolean;
  /** Debounce for the refresh chain, milliseconds. */
  debounceMs: number;
  /** `#rgb`/`#rrggbb`, or '' to inherit the theme's green. */
  addedColor: string;
  /** `#rgb`/`#rrggbb`, or '' to inherit the theme's yellow. */
  modifiedColor: string;
}

export const DEFAULT_SETTINGS: GitGutterSettings = {
  enabled: true,
  showStatusBar: true,
  markUntracked: true,
  debounceMs: 400,
  addedColor: '',
  modifiedColor: '',
};

/** Below ~100 ms every keystroke shells out to git; above a few seconds the gutter feels broken. */
export const DEBOUNCE_MIN = 100;
export const DEBOUNCE_MAX = 3000;
export const DEBOUNCE_STEP = 50;

/** What `styles.css` falls back to when neither a setting nor a theme variable supplies a colour. */
export const FALLBACK_ADDED = '#4caf50';
export const FALLBACK_MODIFIED = '#ffb300';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * A colour is applied by writing a CSS custom property that `styles.css` reads
 * through `var()`. A custom property accepts almost any token, so junk does not
 * fail at assignment — it fails later, at `background: var(--git-gutter-added)`,
 * where an invalid value makes the whole declaration invalid and the marker
 * paints nothing at all. An unreadable gutter is the exact failure this plugin
 * exists to prevent, so the value is checked here rather than trusted.
 */
export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function color(value: unknown): string {
  // '' is the documented "inherit from the theme" value, so it is valid input,
  // not a rejected one.
  if (value === '' || value === undefined || value === null) return '';
  return isValidColor(value) ? value : '';
}

export function clampDebounce(value: unknown): number {
  // Only a number or a numeric string says anything about intent. Everything
  // else goes to the default rather than through Number(), which turns null,
  // '' and false into 0 — and 0 would then clamp to the minimum, quietly
  // reading "no value" as "as fast as possible".
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.debounceMs;
  return Math.min(DEBOUNCE_MAX, Math.max(DEBOUNCE_MIN, Math.round(n)));
}

/**
 * Merge whatever `loadData()` returned onto the defaults.
 *
 * It can be `null` (never saved), a partial object (settings added in a later
 * version), or anything at all (hand-edited `data.json` — a normal thing for
 * this audience to do, since the file sits in a git repository they are looking
 * at). Every field is therefore validated rather than spread in.
 */
export function normalizeSettings(raw: unknown): GitGutterSettings {
  const src = (raw ?? {}) as Partial<Record<keyof GitGutterSettings, unknown>>;
  return {
    enabled: bool(src.enabled, DEFAULT_SETTINGS.enabled),
    showStatusBar: bool(src.showStatusBar, DEFAULT_SETTINGS.showStatusBar),
    markUntracked: bool(src.markUntracked, DEFAULT_SETTINGS.markUntracked),
    debounceMs: src.debounceMs === undefined ? DEFAULT_SETTINGS.debounceMs : clampDebounce(src.debounceMs),
    addedColor: color(src.addedColor),
    modifiedColor: color(src.modifiedColor),
  };
}
