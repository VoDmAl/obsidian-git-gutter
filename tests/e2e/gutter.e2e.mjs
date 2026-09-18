/**
 * End-to-end tests against a running Obsidian, driven through the `obsidian` CLI.
 *
 * They cover what the unit tests cannot reach: whether CodeMirror actually
 * paints a marker where it was asked, what Live Preview does to the document's
 * block structure, and what the status bar ends up saying. That gap is not
 * academic — the bug that started all of this (changes inside a collapsed block
 * never reaching the gutter) lived entirely inside it.
 *
 * The vault is **this repository itself** — `.obsidian/` sits at its root. That
 * means the fixture note is already tracked (so there is something to diff
 * against), the edits land on files under review, no real notes of anyone's are
 * touched, and the plugin's own "run git from the file's directory" logic finds
 * this repo. It also makes the repo dogfood the plugin: open README.md or
 * CLAUDE.md here and the gutter marks your own uncommitted work.
 *
 * Not runnable in CI: needs a desktop Obsidian. Run with `npm run test:e2e`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo is the vault, so one path serves git and Obsidian alike. */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vault = repo;
const VAULT_NAME = basename(repo);
const PLUGIN_ID = 'git-gutter';
const ASSETS = ['main.js', 'styles.css', 'manifest.json'];
const pluginDir = join(vault, '.obsidian', 'plugins', PLUGIN_ID);

const FIXTURE = 'tests/e2e/fixtures/collapsed-block.md';
const fixturePath = join(vault, FIXTURE);
const PROBE = 'tests/e2e/fixtures/untracked-probe.md';

/** The plugin debounces 400 ms, then shells out to git; give the whole chain room. */
const SETTLE_MS = 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every call names the vault, so a window the developer happens to have open is never touched. */
function ob(...args) {
  return execFileSync('obsidian', [`vault=${VAULT_NAME}`, ...args], { encoding: 'utf8', timeout: 30_000 });
}

function obEval(code) {
  const out = ob('eval', `code=${code}`);
  const line = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('=>')).pop();
  if (!line) throw new Error(`obsidian eval produced no result:\n${out}`);
  return line.slice(2).trim();
}

const obJson = (code) => JSON.parse(obEval(code));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const ctx = { ready: false, skipReason: '', committed: false, uncommittedReason: '', lines: [], original: '' };

/**
 * Lines are addressed by the sentence they contain rather than by number, so
 * editing the fixture's prose does not silently re-point the assertions at the
 * wrong line.
 */
function lineOf(needle) {
  const i = ctx.lines.findIndex((l) => l.includes(needle));
  if (i === -1) throw new Error(`fixture no longer contains ${JSON.stringify(needle)}`);
  return i + 1;
}

const INNER = 'THIRD LINE INSIDE THE BLOCK';
const CONTROL = 'PLAIN PARAGRAPH AFTER THE BLOCK';

/** Gutter elements of the active editor, each mapped back to the lines it covers. */
function gutterMarkers() {
  return obJson(`(()=>{const l=app.workspace.activeLeaf;const cm=l.view.editor?.cm;
    if(!cm)return JSON.stringify([]);
    const scope=cm.dom.parentElement||cm.dom;const out=[];
    scope.querySelectorAll('.cm-git-gutter .cm-gutterElement').forEach(e=>{
      const r=e.getBoundingClientRect();
      if(!e.firstChild||r.height===0)return;
      const b=cm.lineBlockAtHeight(r.top+r.height/2-cm.documentTop);
      out.push({from:cm.state.doc.lineAt(b.from).number,to:cm.state.doc.lineAt(b.to).number,
        type:e.firstChild.className.replace('git-gutter-marker git-gutter-','')});
    });
    return JSON.stringify(out)})()`);
}

function statusBar() {
  return obJson(`(()=>{const el=document.querySelector('.git-gutter-status');
    if(!el)return JSON.stringify({present:false});
    return JSON.stringify({present:true,visible:el.style.display!=='none',
      text:el.textContent,tooltip:el.getAttribute('aria-label')||''})})()`);
}

/** Block structure as CodeMirror sees it: 0 = plain text, 3 = a collapsed widget range. */
function blockOf(lineNum) {
  return obJson(`(()=>{const cm=app.workspace.activeLeaf.view.editor.cm;
    const b=cm.lineBlockAt(cm.state.doc.line(${lineNum}).from);
    return JSON.stringify({from:cm.state.doc.lineAt(b.from).number,to:cm.state.doc.lineAt(b.to).number,
      type:Array.isArray(b.type)?'array':b.type})})()`);
}

/** CodeMirror renders only the viewport; anything below it has no gutter element to find. */
async function showLine(n) {
  obEval(`(()=>{const cm=app.workspace.activeLeaf.view.editor.cm;
    cm.scrollDOM.scrollTop=Math.max(0,cm.lineBlockAt(cm.state.doc.line(${n}).from).top-250);
    return 'ok'})()`);
  await sleep(600);
}

/** Writes go to disk, never through the editor — that is how the plugin is really used. */
async function writeFixture(lines) {
  writeFileSync(fixturePath, lines.join('\n'));
  await sleep(SETTLE_MS);
}

/** Ask Obsidian to open the fixture vault. The first time, this raises a dialog. */
function openVault() {
  execFileSync('open', [`obsidian://open?path=${encodeURIComponent(vault)}`]);
}

function vaultReachable() {
  try {
    return obEval('app.vault.getName()') === VAULT_NAME;
  } catch {
    return false;
  }
}

before(async () => {
  try {
    execFileSync('obsidian', ['--help'], { encoding: 'utf8' });
  } catch {
    ctx.skipReason = 'the `obsidian` CLI is not available';
    return;
  }

  // Anything that diffs the fixture needs it committed — `git diff HEAD` is what
  // the plugin reads. The block-structure and untracked scenarios do not, so
  // this only disables the tests it has to.
  const status = git('status', '--porcelain', '--', FIXTURE).trim();
  ctx.committed = status === '';
  if (!ctx.committed) {
    ctx.uncommittedReason = `${FIXTURE} is not committed (${status.slice(0, 2).trim() || 'modified'}) — commit it, then re-run`;
  }

  // Build first. Without this the suite installs whatever `main.js` happens to
  // be lying in the repo and reports on a stale bundle — a green run that means
  // nothing, which is precisely the failure this suite exists to catch.
  execFileSync('npm', ['run', 'build'], { cwd: repo, encoding: 'utf8' });
  mkdirSync(pluginDir, { recursive: true });
  for (const asset of ASSETS) {
    copyFileSync(join(repo, asset), join(pluginDir, asset));
    // A copy that silently did not happen would put us back in the stale-bundle
    // hole, so compare the bytes rather than trusting the call.
    assert.deepEqual(
      readFileSync(join(pluginDir, asset)),
      readFileSync(join(repo, asset)),
      `${asset} was not installed into the vault`
    );
  }

  if (!vaultReachable()) {
    openVault();
    for (let i = 0; i < 20 && !vaultReachable(); i++) await sleep(1000);
  }
  if (!vaultReachable()) {
    // Obsidian asks for confirmation the first time a folder is opened as a
    // vault, and that dialog cannot be answered from here.
    ctx.skipReason =
      `Obsidian has not opened the ${VAULT_NAME} vault. A confirmation dialog may be waiting — ` +
      `accept it, or open ${vault} once via Obsidian → Open folder as vault, then re-run.`;
    return;
  }

  ob('plugin:reload', `id=${PLUGIN_ID}`);
  await sleep(1000);
  assert.equal(obEval(`!!app.plugins.plugins['${PLUGIN_ID}']`), 'true', 'the plugin failed to load in the vault');
  ctx.original = readFileSync(fixturePath, 'utf8');
  ctx.lines = ctx.original.split('\n');
  ob('open', `path=${FIXTURE}`);
  await sleep(SETTLE_MS);
  ctx.ready = true;
});

after(async () => {
  try {
    git('checkout', '--', FIXTURE);
  } catch {
    if (ctx.original) writeFileSync(fixturePath, ctx.original);
  }
  rmSync(join(vault, PROBE), { force: true });
});

function guard(t, needsCommittedFixture = true) {
  if (!ctx.ready) {
    t.skip(ctx.skipReason || 'fixture vault unavailable');
    return false;
  }
  if (needsCommittedFixture && !ctx.committed) {
    t.skip(ctx.uncommittedReason);
    return false;
  }
  return true;
}

test('Live Preview really does collapse the fixture block', async (t) => {
  // Pure editor structure — true whether or not the fixture is committed.
  if (!guard(t, false)) return;

  // Everything below depends on the editor being in Live Preview; in Source mode
  // every line is its own block and the interesting case cannot occur. The vault
  // pins this in .obsidian/app.json, so a failure here means it was overridden.
  const view = obJson(`(()=>{const s=app.workspace.activeLeaf.getViewState().state;
    return JSON.stringify({mode:s.mode,source:s.source})})()`);
  assert.deepEqual(view, { mode: 'source', source: false }, 'the editor must be in Live Preview');

  const inner = lineOf(INNER);
  const block = blockOf(inner);
  assert.equal(block.type, 3, `line ${inner} must sit in a widget range, got ${JSON.stringify(block)}`);
  assert.ok(block.from < inner, 'the edited line must not be the block\'s first line');
  assert.ok(block.to > inner, 'the edited line must not be the block\'s last line');
  // A control on the other side: the plain paragraph is its own text block.
  assert.equal(blockOf(lineOf(CONTROL)).type, 0);
});

test('a clean tracked file shows no markers and a ±0 counter', async (t) => {
  if (!guard(t)) return;
  await showLine(lineOf(INNER));
  assert.deepEqual(gutterMarkers(), [], 'a committed file must not be marked');
  const status = statusBar();
  assert.equal(status.visible, true);
  assert.match(status.text, /±0$/);
  assert.match(status.tooltip, /no uncommitted changes/i);
});

test('a change inside a collapsed block reaches the gutter', async (t) => {
  if (!guard(t)) return;
  const inner = lineOf(INNER);
  const control = lineOf(CONTROL);
  const lines = [...ctx.lines];
  lines[inner - 1] = lines[inner - 1].replace(INNER, `${INNER} (edited)`);
  lines[control - 1] = lines[control - 1].replace(CONTROL, `${CONTROL} (edited)`);
  await writeFixture(lines);
  await showLine(inner);

  const markers = gutterMarkers();
  const onBlock = markers.find((m) => m.from <= inner && m.to >= inner);
  assert.ok(onBlock, `line ${inner} is inside a collapsed block and must be marked; got ${JSON.stringify(markers)}`);
  assert.equal(onBlock.type, 'modified', 'a replaced line is modified, not added');

  // The control proves the gutter paints at all, so a failure above is about
  // collapsed blocks specifically rather than about the plugin being dead.
  const onControl = markers.find((m) => m.from <= control && m.to >= control);
  assert.ok(onControl, `the plain control line ${control} must be marked; got ${JSON.stringify(markers)}`);
  assert.equal(onControl.type, 'modified');
});

test('the counter reports both changed lines', async (t) => {
  if (!guard(t)) return;
  const status = statusBar();
  assert.match(status.text, /~2$/, `expected two modified lines, got ${status.text}`);
  assert.match(status.tooltip, /0 added, 2 modified/);
});

test('an untracked file is named as untracked, not reported as unchanged', async (t) => {
  // Its own probe file, nothing to do with the fixture's git state.
  if (!guard(t, false)) return;
  writeFileSync(join(vault, PROBE), '# probe\n\nnot in git\n');
  // Obsidian indexes the vault before `open` can resolve a brand-new file.
  await sleep(3000);
  ob('open', `path=${PROBE}`);
  await sleep(SETTLE_MS);

  assert.equal(obEval('app.workspace.getActiveFile()?.path'), PROBE, 'the probe must be the active file');
  assert.match(statusBar().text, /untracked$/);
  assert.deepEqual(gutterMarkers(), [], 'nothing to diff against means nothing to mark');
});

test('reverting the file clears the gutter again', async (t) => {
  if (!guard(t)) return;
  git('checkout', '--', FIXTURE);
  ob('open', `path=${FIXTURE}`);
  await sleep(SETTLE_MS);
  await showLine(lineOf(INNER));

  assert.deepEqual(gutterMarkers(), [], 'a restored file must go back to unmarked');
  assert.match(statusBar().text, /±0$/);
});
