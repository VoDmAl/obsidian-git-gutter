import {
  App,
  Plugin,
  PluginSettingTab,
  MarkdownView,
  Setting,
  debounce,
  FileSystemAdapter,
  Debouncer,
  setTooltip,
} from 'obsidian';
import { RangeSet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  DiffMark,
  GutterStatus,
  buildMarkers,
  diffField,
  diffGutter,
  markAllAdded,
  parseDiff,
  setDiffEffect,
  shellQuote,
} from './diff.ts';
import {
  DEBOUNCE_MAX,
  DEBOUNCE_MIN,
  DEBOUNCE_STEP,
  FALLBACK_ADDED,
  FALLBACK_MODIFIED,
  GitGutterSettings,
  isValidColor,
  normalizeSettings,
} from './settings.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execP = promisify(exec);

/** `styles.css` reads these through `var()`, with the theme's colour as the fallback. */
const COLOR_VARS = {
  added: '--git-gutter-added',
  modified: '--git-gutter-modified',
} as const;

/** The theme variables those fall back to, and what to show in the picker when neither exists. */
const THEME_VARS = {
  added: { name: '--color-green', fallback: FALLBACK_ADDED },
  modified: { name: '--color-yellow', fallback: FALLBACK_MODIFIED },
} as const;

export default class GitGutterPlugin extends Plugin {
  settings!: GitGutterSettings;

  private refresh!: Debouncer<[], void>;
  private status!: HTMLElement;

  /**
   * Registered once, then mutated in place: that is the documented way to
   * reconfigure a plugin's CM6 extensions on the fly ("an array should be
   * passed in, and modified dynamically. Once this array is modified, calling
   * Workspace.updateOptions will apply the changes" — `registerEditorExtension`).
   * Turning the gutter off therefore removes the extension outright rather than
   * feeding it an empty marker set, so the 3 px column goes away with it.
   */
  private readonly editorExtensions: Extension[] = [];

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());

    this.registerEditorExtension(this.editorExtensions);

    this.status = this.addStatusBarItem();
    this.status.addClass('git-gutter-status');
    this.hideStatus();

    this.addSettingTab(new GitGutterSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.refresh()));
    this.registerEvent(this.app.vault.on('modify', () => this.refresh()));

    this.applyColors();
    this.rebuildDebounce();
    this.applyGutterExtension();

    this.app.workspace.onLayoutReady(() => this.refresh());
  }

  override onunload(): void {
    // Obsidian unloads styles.css on its own, but these live on <body> and would
    // outlast the plugin, tinting nothing and confusing the next install.
    for (const prop of Object.values(COLOR_VARS)) document.body.style.removeProperty(prop);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyColors();
    this.rebuildDebounce();
    this.applyGutterExtension();
    this.refresh();
  }

  /** '' means "whatever the theme says", which is what `styles.css` does without an override. */
  private applyColors(): void {
    const chosen = { added: this.settings.addedColor, modified: this.settings.modifiedColor };
    for (const key of ['added', 'modified'] as const) {
      const prop = COLOR_VARS[key];
      if (chosen[key]) document.body.style.setProperty(prop, chosen[key]);
      else document.body.style.removeProperty(prop);
    }
  }

  private rebuildDebounce(): void {
    // The handlers call `this.refresh()` rather than holding the debouncer, so
    // replacing the field is enough to change the interval for all of them.
    this.refresh = debounce(() => void this.refreshActive(), this.settings.debounceMs, true);
  }

  private applyGutterExtension(): void {
    const wanted = this.settings.enabled;
    const present = this.editorExtensions.length > 0;
    if (wanted === present) return;

    this.editorExtensions.length = 0;
    if (wanted) this.editorExtensions.push(diffField, diffGutter);
    this.app.workspace.updateOptions();
  }

  private async refreshActive(): Promise<void> {
    // Off means off: no gutter, no status bar, and — the part that matters on a
    // large vault — no git subprocess per keystroke.
    if (!this.settings.enabled) return this.hideStatus();

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
      if (marks.length > 0) {
        this.paint(cm, marks);
        this.showStatus({ kind: 'changes', marks });
        return;
      }

      // An untracked file yields an empty diff and exit 0, exactly like a clean
      // one. Reporting it as "no changes" would be the very lie this counter
      // exists to prevent, so the empty case costs one extra git call.
      const tracked = await isTracked(fileDir, fileName);
      if (tracked) {
        this.paint(cm, []);
        this.showStatus({ kind: 'clean' });
        return;
      }

      // Nothing in HEAD to compare against, so every line of it is new. An
      // empty buffer has no line to mark — `doc.lines` is 1 even then.
      const untrackedMarks =
        this.settings.markUntracked && cm.state.doc.length > 0
          ? markAllAdded(cm.state.doc.lines)
          : [];
      this.paint(cm, untrackedMarks);
      this.showStatus({ kind: 'untracked', marks: untrackedMarks });
    } catch {
      // No git on PATH, not a repository, no HEAD yet, timeout.
      cm.dispatch({ effects: setDiffEffect.of(RangeSet.empty) });
      this.showStatus({ kind: 'unavailable' });
    }
  }

  private paint(cm: EditorView, marks: DiffMark[]): void {
    cm.dispatch({ effects: setDiffEffect.of(buildMarkers(marks, cm.state.doc)) });
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
    if (!this.settings.showStatusBar) return this.hideStatus();

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
      // `+N untracked`: the count agrees with the full gutter, the word keeps
      // this state apart from an ordinary changed file. With marking off — or on
      // an empty file — there is no count and it reads plain `untracked`, which
      // is still not `±0`.
      const n = status.marks.length;
      if (n > 0) el.createSpan({ cls: 'git-gutter-status-added', text: `+${n}` });
      el.createSpan({ text: 'untracked' });
      setTooltip(
        el,
        n > 0
          ? `Git Gutter: untracked file — nothing in HEAD to compare against, so all ${n} lines count as added`
          : 'Git Gutter: file is not tracked by git — nothing to compare against, so no markers'
      );
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

/**
 * The colour a marker would paint with no override — the theme's own green or
 * yellow. The picker has to show *something* concrete even when the setting is
 * the empty "inherit" value, and showing the inherited colour is what makes the
 * reset button's effect visible.
 */
function themeColor(key: 'added' | 'modified'): string {
  const { name, fallback } = THEME_VARS[key];
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return isValidColor(value) ? value : fallback;
}

class GitGutterSettingTab extends PluginSettingTab {
  private readonly plugin: GitGutterPlugin;

  constructor(app: App, plugin: GitGutterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Enable gutter')
      .setDesc('Off removes the markers and stops the plugin running git for this vault.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Show status bar counter')
      .setDesc(
        'Names what the gutter cannot: +N ~M for changed lines, ±0 for a tracked file with nothing to show, ' +
          'untracked, or — when no diff could be produced. An empty gutter has four causes and they look alike.'
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
          this.plugin.settings.showStatusBar = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Mark untracked files')
      .setDesc(
        'A file git does not follow has nothing in HEAD to compare against, so every line of it is new. ' +
          'Turn this off in a vault where most notes are untracked and a fully green gutter is noise.'
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.markUntracked).onChange(async (value) => {
          this.plugin.settings.markUntracked = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Refresh delay')
      .setDesc(
        'How long to wait after the last edit before running git again, in milliseconds. ' +
          'Lower reacts sooner and shells out more often.'
      )
      .addSlider((s) =>
        s
          .setLimits(DEBOUNCE_MIN, DEBOUNCE_MAX, DEBOUNCE_STEP)
          .setValue(this.plugin.settings.debounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.debounceMs = value;
            await this.plugin.saveSettings();
          })
      );

    this.addColorSetting(
      'added',
      'Added line colour',
      'Lines with no counterpart in HEAD. Empty means the theme’s own green.'
    );
    this.addColorSetting(
      'modified',
      'Modified line colour',
      'Lines that replaced a line in HEAD. Empty means the theme’s own yellow.'
    );
  }

  private addColorSetting(key: 'added' | 'modified', name: string, desc: string): void {
    const field = key === 'added' ? 'addedColor' : 'modifiedColor';
    const current = this.plugin.settings[field];

    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addColorPicker((picker) =>
        // With nothing chosen the picker shows the inherited colour, so the
        // swatch always matches what the gutter actually paints.
        picker.setValue(current || themeColor(key)).onChange(async (value) => {
          this.plugin.settings[field] = isValidColor(value) ? value : '';
          await this.plugin.saveSettings();
        })
      )
      .addExtraButton((b) =>
        b
          .setIcon('rotate-ccw')
          .setTooltip('Follow the theme')
          .setDisabled(current === '')
          .onClick(async () => {
            this.plugin.settings[field] = '';
            await this.plugin.saveSettings();
            // The picker holds the old swatch; redraw so it shows the inherited one.
            this.display();
          })
      );
  }
}
