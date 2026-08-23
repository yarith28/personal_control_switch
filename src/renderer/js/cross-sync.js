// Cross Sync page — link two independent repos and move commits between them.
// The heavy lifting (fetch-by-path, merge, cherry-pick) lives in the main
// process; this module is the UI + orchestration on top of window.api.cross*.
import { getProjects } from './state.js';
import { basename } from './util.js';
import { log, logDetails } from './log.js';
import { showToast } from './notify.js';
import { refreshAll } from './branches.js';
import { confirmDialog, promptDialog } from './modal.js';
import { createBranchPicker } from './branch-picker.js';
import { createProjectOpenMenu } from './project-open-menu.js';
import { iconElement } from './icons.js';

let links = [];
let pageEl = null;
let contentEl = null;
let autoRefreshReady = false;
let lastAutoRefreshAt = 0;
const branchCache = new Map(); // repo path -> { branches, current, error }

function ipcFailure(error, fallback) {
  const raw = error?.message || String(error);
  return { ok: false, error: fallback, raw };
}

function uid() {
  return 'lnk-' + Math.random().toString(36).slice(2, 9);
}

// Tiny DOM builder: el('div', { class, text, onclick, ...attrs }, [children])
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function normalizeLink(raw) {
  if (!raw || !raw.a || !raw.b) return null;
  return { id: raw.id || uid(), a: raw.a, b: raw.b, branchA: raw.branchA || null, branchB: raw.branchB || null };
}

function samePair(link, a, b) {
  return (link.a === a && link.b === b) || (link.a === b && link.b === a);
}

async function saveLinks() {
  await window.api.saveConfig({ links });
}

async function getBranches(path) {
  if (branchCache.has(path)) return branchCache.get(path);
  let res;
  try {
    res = await window.api.getBranches(path);
  } catch (error) {
    res = ipcFailure(error, 'Could not inspect this repository.');
  }
  const info = res.ok
    ? { branches: res.branches, current: res.current, error: null }
    : { branches: [], current: null, error: res.error };
  branchCache.set(path, info);
  return info;
}

export function setupCrossSync(initialLinks = []) {
  pageEl = document.getElementById('page-cross-sync');
  contentEl = document.getElementById('cross-content');
  if (!pageEl || !contentEl) return;
  links = (Array.isArray(initialLinks) ? initialLinks : []).map(normalizeLink).filter(Boolean);
  setupAutoRefresh();
  renderPage();
}

function setupAutoRefresh() {
  if (autoRefreshReady) return;
  autoRefreshReady = true;

  window.addEventListener('pcs:tab-change', (event) => {
    if (event.detail?.name !== 'cross-sync') return;
    branchCache.clear();
    renderPage();
  });
  window.addEventListener('focus', refreshVisibleLinks);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshVisibleLinks();
  });
}

function findLinkCard(link) {
  return Array.from(contentEl?.querySelectorAll('.link-card') || [])
    .find((card) => card.dataset.id === String(link.id));
}

function refreshVisibleLinks() {
  if (!pageEl || pageEl.hasAttribute('hidden') || document.hidden) return;
  const now = Date.now();
  if (now - lastAutoRefreshAt < 500) return;
  lastAutoRefreshAt = now;
  for (const link of links) {
    if (!link.branchA || !link.branchB) continue;
    const card = findLinkCard(link);
    if (card) compareLink(link, card, card.querySelector('.link-compare'));
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderPage() {
  const sharedControls = document.getElementById('shared-tab-controls');
  // Branch pickers portal their dropdowns onto <body>; drop orphaned ones so
  // rebuilding the card list doesn't leak them.
  document.querySelectorAll('.branch-dropdown[data-picker-scope="cross"]').forEach((d) => d.remove());
  document.querySelectorAll('.move-dropdown[data-menu-scope="cross"]').forEach((d) => d.remove());
  contentEl.replaceChildren(
    el('div', { class: 'cross-head' }, [
      el('button', { class: 'btn btn-primary', onclick: toggleCreate }, ['+ New link']),
    ]),
    buildCreateForm(),
    el('div', { class: 'cross-list', id: 'cross-list' },
      links.length ? links.map(buildLinkCard) : [el('div', { class: 'cross-empty' }, [
        el('div', { class: 'cross-empty-title', text: 'No links yet' }),
        el('div', { class: 'cross-empty-copy', text: 'Link two repositories to sync branches between them.' }),
      ])]
    )
  );
  if (sharedControls && !pageEl.hasAttribute('hidden')) {
    contentEl.querySelector('.cross-head')?.appendChild(sharedControls);
  }
}

// A repo picker: existing projects as options, plus "Choose folder…" which opens
// the native folder picker so any repo can be linked, not just listed projects.
function repoSlot(preselect) {
  const projects = getProjects();
  const sel = el('select', { class: 'cross-select' }, [
    el('option', { value: '', text: 'Select repo…', disabled: true, selected: !preselect }),
    ...projects.map((p) => el('option', { value: p.path, text: basename(p.path), selected: preselect === p.path })),
    el('option', { value: '__browse__', text: 'Choose folder…' }),
  ]);
  if (preselect) sel.dataset.prev = preselect;
  sel.addEventListener('change', async () => {
    if (sel.value !== '__browse__') {
      sel.dataset.prev = sel.value;
      return;
    }
    const dirs = await window.api.pickFolders();
    const dir = Array.isArray(dirs) ? dirs[0] : null;
    if (!dir) {
      sel.value = sel.dataset.prev || '';
      return;
    }
    if (![...sel.options].some((o) => o.value === dir)) {
      sel.insertBefore(el('option', { value: dir, text: basename(dir) }), sel.lastElementChild);
    }
    sel.value = dir;
    sel.dataset.prev = dir;
  });
  return sel;
}

function buildCreateForm() {
  const projects = getProjects();
  const slotA = repoSlot(projects[0]?.path);
  const slotB = repoSlot(projects[1]?.path);
  return el('div', { class: 'cross-create', id: 'cross-create', hidden: true }, [
    el('span', { class: 'cross-create-label', text: 'Link' }),
    slotA,
    el('span', { class: 'cross-create-arrow', text: '⇄' }),
    slotB,
    el('button', { class: 'btn btn-primary', onclick: () => createLink(slotA.value, slotB.value) }, ['Create link']),
  ]);
}

function toggleCreate() {
  const existing = pageEl.querySelector('#cross-create');
  if (!existing) return;
  if (!existing.hasAttribute('hidden')) {
    existing.setAttribute('hidden', '');
    return;
  }
  const fresh = buildCreateForm(); // rebuild so the repo list is current
  fresh.removeAttribute('hidden');
  existing.replaceWith(fresh);
}

function buildLinkCard(link) {
  const repoNameA = el('span', { class: 'repo-name', text: basename(link.a), title: link.a });
  const repoNameB = el('span', { class: 'repo-name', text: basename(link.b), title: link.b });
  createProjectOpenMenu({ trigger: repoNameA, projectPath: link.a, scope: 'cross' });
  createProjectOpenMenu({ trigger: repoNameB, projectPath: link.b, scope: 'cross' });

  const pickerA = createBranchPicker({
    scope: 'cross',
    title: 'Select branch for comparison',
    onSelect: (b) => setLinkBranch(link, 'a', b),
  });
  const pickerB = createBranchPicker({
    scope: 'cross',
    title: 'Select branch for comparison',
    onSelect: (b) => setLinkBranch(link, 'b', b),
  });
  const card = el('article', { class: 'link-card', 'data-id': link.id }, [
    el('div', { class: 'link-layout' }, [
      el('div', { class: 'repo-unit repo-a' }, [
        repoNameA,
        pickerA.el,
      ]),
      el('div', { class: 'link-center' }, [
        el('div', { class: 'link-delta' }, [el('div', { class: 'link-loading', text: 'Loading…' })]),
        el('div', { class: 'link-tools' }, [
          el('button', { class: 'link-compare', title: 'Refresh branch comparison', 'aria-label': 'Refresh branch comparison', onclick: (e) => compareLink(link, card, e.currentTarget) }, [
            iconElement('refresh', { size: 14, strokeWidth: 1.9 }),
          ]),
          el('button', { class: 'link-remove', title: 'Remove repository link', 'aria-label': 'Remove repository link', onclick: () => removeLink(link) }, [
            iconElement('trash2', { size: 14, strokeWidth: 1.9 }),
          ]),
        ]),
      ]),
      el('div', { class: 'repo-unit repo-b' }, [
        repoNameB,
        pickerB.el,
      ]),
    ]),
  ]);

  // Load branches for both sides, then auto-compare so the card shows its delta
  // on open without the user having to hit refresh.
  Promise.all([
    loadPickerBranches(pickerA, link.a, link.branchA),
    loadPickerBranches(pickerB, link.b, link.branchB),
  ]).then(([branchA, branchB]) => {
    let changed = false;
    if (branchA && link.branchA !== branchA) {
      link.branchA = branchA;
      changed = true;
    }
    if (branchB && link.branchB !== branchB) {
      link.branchB = branchB;
      changed = true;
    }
    if (changed) saveLinks();
    if (link.branchA && link.branchB) {
      compareLink(link, card, card.querySelector('.link-compare'));
    }
  });

  return card;
}

async function loadPickerBranches(picker, path, chosen) {
  const info = await getBranches(path);
  return picker.setBranches(info.branches, info.current, chosen);
}

function setLinkBranch(link, side, branch) {
  const key = side === 'a' ? 'branchA' : 'branchB';
  if (link[key] === branch) return;
  link[key] = branch;
  saveLinks();
  if (link.branchA && link.branchB) {
    const card = findLinkCard(link);
    if (card) compareLink(link, card, card.querySelector('.link-compare'));
  }
}

// ── Link lifecycle ───────────────────────────────────────────────────────────

async function createLink(a, b) {
  if (!a || !b || a === '__browse__' || b === '__browse__') {
    showToast('Pick a repo on each side');
    return;
  }
  if (a === b) {
    showToast('Pick two different repos');
    return;
  }
  if (links.some((l) => samePair(l, a, b))) {
    showToast('Those two are already linked');
    return;
  }
  links.push({ id: uid(), a, b, branchA: null, branchB: null });
  await saveLinks();
  renderPage();
}

async function removeLink(link) {
  const confirmed = await confirmDialog({
    message: `Remove the link between ${basename(link.a)} and ${basename(link.b)}?`,
    detail: 'This removes the saved Cross Sync link. Repository files, branches, and commits will not be changed.',
    confirmText: 'Remove link',
    cancelText: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  links = links.filter((l) => l.id !== link.id);
  await saveLinks();
  renderPage();
}

// ── Compare / merge / cherry-pick ────────────────────────────────────────────

async function compareLink(link, card, btn) {
  if (!card?.isConnected || !link.branchA || !link.branchB) return;
  if (card.dataset.comparing === 'true') {
    card.dataset.compareQueued = 'true';
    return;
  }

  card.dataset.comparing = 'true';
  const sourceBranch = link.branchA;
  const targetBranch = link.branchB;
  if (btn) btn.disabled = true;
  const delta = card.querySelector('.link-delta');
  delta?.replaceChildren(el('div', { class: 'link-loading', text: 'Comparing…' }));
  try {
    let res;
    try {
      res = await window.api.crossCompare({
        sourcePath: link.a, sourceBranch,
        targetPath: link.b, targetBranch,
      });
    } catch (error) {
      res = ipcFailure(error, 'Compare failed before Git returned a result.');
    }
    if (card.isConnected && link.branchA === sourceBranch && link.branchB === targetBranch) {
      renderDelta(link, card, res);
    }
  } finally {
    if (btn) btn.disabled = false;
    delete card.dataset.comparing;
    const shouldRepeat = card.dataset.compareQueued === 'true'
      || link.branchA !== sourceBranch
      || link.branchB !== targetBranch;
    delete card.dataset.compareQueued;
    if (shouldRepeat && card.isConnected) {
      compareLink(link, card, card.querySelector('.link-compare'));
    }
  }
}

function renderDelta(link, card, res) {
  const delta = card.querySelector('.link-delta');
  if (!res.ok) {
    delta.replaceChildren(el('div', { class: 'link-error', text: res.error || 'Compare failed.' }));
    if (res.raw) logDetails(`[cross] compare failed: ${res.error || ''}`, res.raw);
    return;
  }

  const aName = basename(link.a);
  const bName = basename(link.b);
  delta.replaceChildren(el('div', { class: 'dir-grid' }, [
    // Actions that move B into A point left.
    directionBlock({
      commits: res.outgoing,
      source: bName, sourceBranch: link.branchB,
      target: aName, targetBranch: link.branchA,
      related: res.related,
      direction: 'left',
      onIntegrate: () => runIntegrate(link, card, 'b2a', res.outgoing),
      onFetch: () => runFetchBranch(link, 'b2a'),
    }),
    // Actions that move A into B point right.
    directionBlock({
      commits: res.incoming,
      source: aName, sourceBranch: link.branchA,
      target: bName, targetBranch: link.branchB,
      related: res.related,
      direction: 'right',
      onIntegrate: () => runIntegrate(link, card, 'a2b', res.incoming),
      onFetch: () => runFetchBranch(link, 'a2b'),
    }),
  ]));
}

function directionBlock({ commits, sourceBranch, target, targetBranch, related, direction, onIntegrate, onFetch }) {
  const rebaseBlocked = !commits.length || !related;
  const rebaseError = !related
    ? 'The selected branches do not share a common Git ancestor.'
    : `No commits from ${sourceBranch} need to be integrated into ${targetBranch}.`;
  const actionContent = (label) => {
    const arrow = iconElement(direction === 'left' ? 'arrowLeft' : 'arrowRight', { size: 12, strokeWidth: 2 });
    const text = el('span', { class: 'dir-action-label', text: label });
    return direction === 'left' ? [arrow, text] : [text, arrow];
  };
  return el('div', { class: `dir-actions dir-${direction}` }, [
    el('button', {
      class: `btn btn-pull dir-rebase${rebaseBlocked ? ' is-disabled' : ''}`,
      onclick: () => {
        if (rebaseBlocked) {
          showToast('Rebase unavailable', rebaseError, { tone: 'error' });
          return;
        }
        onIntegrate();
      },
      'aria-disabled': rebaseBlocked ? 'true' : null,
      title: related ? `Update ${targetBranch} by rebasing it onto ${sourceBranch}` : 'Rebase requires related Git histories',
    }, actionContent(`Rebase${commits.length ? ` (${commits.length})` : ''}`)),
    el('button', {
      class: 'btn btn-push dir-copy',
      onclick: () => onFetch(),
      title: `Copy ${sourceBranch} into ${target}`,
    }, actionContent('Copy')),
  ]);
}

function endpoints(link, dir) {
  return dir === 'a2b'
    ? { srcPath: link.a, srcBranch: link.branchA, tgtPath: link.b, tgtBranch: link.branchB }
    : { srcPath: link.b, srcBranch: link.branchB, tgtPath: link.a, tgtBranch: link.branchA };
}

async function runIntegrate(link, card, dir, commits = []) {
  const { srcPath, srcBranch, tgtPath, tgtBranch } = endpoints(link, dir);

  const MAX_LISTED = 6;
  const lines = commits.slice(0, MAX_LISTED).map((c) => `${c.shortSha}  ${c.subject}`);
  if (commits.length > MAX_LISTED) lines.push(`…and ${commits.length - MAX_LISTED} more`);

  const confirmed = await confirmDialog({
    message: `Update ${basename(tgtPath)}/${tgtBranch} with work from ${basename(srcPath)}/${srcBranch}?`,
    detail: [
      `This checks out ${tgtBranch} and rebases it onto ${srcBranch}. Commits unique to the target may receive new IDs.`,
      '',
      `${commits.length} source commit${commits.length === 1 ? '' : 's'} to integrate:`,
      ...lines,
    ].join('\n'),
    confirmText: `Update ${basename(tgtPath)}`,
    cancelText: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  log(`[cross] updating ${basename(tgtPath)}/${tgtBranch} from ${basename(srcPath)}/${srcBranch} by rebase...`);
  let res;
  try {
    res = await window.api.crossIntegrate({
      sourcePath: srcPath, sourceBranch: srcBranch,
      targetPath: tgtPath, targetBranch: tgtBranch,
    });
  } catch (error) {
    res = ipcFailure(error, 'Cross Sync failed before Git returned a result.');
  }
  await handleOpResult(res, `Updated ${basename(tgtPath)}`, tgtPath, link, card);
}

async function runFetchBranch(link, dir) {
  const { srcPath, srcBranch, tgtPath } = endpoints(link, dir);
  const name = await promptDialog({
    message: `Copy ${basename(srcPath)}/${srcBranch} into ${basename(tgtPath)}`,
    detail: 'Creates or fast-forwards a local branch in the destination. It does not push to a remote or change the working tree.',
    defaultValue: srcBranch,
    placeholder: 'Destination branch name',
    confirmText: 'Copy',
  });
  if (!name) return;
  log(`[cross] copying ${basename(srcPath)}/${srcBranch} → ${basename(tgtPath)} as ${name}...`);
  let res;
  try {
    res = await window.api.crossFetchBranch({
      sourcePath: srcPath, sourceBranch: srcBranch, targetPath: tgtPath, name,
    });
  } catch (error) {
    res = ipcFailure(error, 'Copy failed before Git returned a result.');
  }
  if (res.ok) {
    showToast(`Copied as ${res.name}`, `Local branch in ${basename(tgtPath)}`);
    log(`[cross] copied branch "${res.name}" into ${basename(tgtPath)}`, true);
    branchCache.delete(tgtPath);
    await refreshAll({ force: true });
  } else {
    showToast('Copy failed', res.error || '', { tone: 'error' });
    if (res.raw) logDetails(`[cross] ${res.error || 'copy failed'}`, res.raw);
    else log(`[cross] ${res.error || 'copy failed'}`, true);
  }
}

async function handleOpResult(res, successTitle, targetPath, link, card) {
  if (res.ok) {
    showToast(successTitle);
    log(`[cross] ${successTitle}${res.output ? '\n' + res.output : ''}`, true);
    // The target's branches/commits moved — drop cached branch info and refresh
    // the Git Sync list, then re-run compare so the deltas reflect the new state.
    branchCache.delete(link.a);
    branchCache.delete(link.b);
    await refreshAll({ force: true });
    await compareLink(link, card, card.querySelector('.link-compare'));
    return;
  }
  if (res.conflict) {
    showToast('Conflicts — needs a manual merge', res.error, { tone: 'error' });
    log(`[cross] ${res.error}`, true);
    showConflictHelp(card, targetPath);
    return;
  }
  showToast('Cross Sync failed', res.error || '', { tone: 'error' });
  logDetails(`[cross] ${res.error || 'failed'}`, res.raw || '');
}

function showConflictHelp(card, targetPath) {
  const delta = card.querySelector('.link-delta');
  delta.prepend(el('div', { class: 'conflict-help' }, [
    el('span', { text: 'Resolve it in a terminal, then re-compare.' }),
    el('button', {
      class: 'btn',
      onclick: async () => {
        let result;
        try {
          result = await window.api.openTerminal(targetPath);
        } catch (error) {
          result = ipcFailure(error, 'Terminal could not be opened.');
        }
        if (!result?.ok) {
          const message = result?.error || 'Terminal could not be opened.';
          showToast('Could not open Terminal', message, { tone: 'error' });
          log(`[cross] ${message}`, true);
        }
      },
    }, ['Open terminal']),
  ]));
}
