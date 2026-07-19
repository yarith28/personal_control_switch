import { getProjects } from './state.js';
import { basename } from './util.js';
import { iconElement } from './icons.js';
import { showToast } from './notify.js';
import { confirmDialog } from './modal.js';
import { log, logDetails } from './log.js';
import { refreshAll } from './branches.js';

let root = null;
let toolbar = null;
let projectSelect = null;
let branchLabel = null;
let historyList = null;
let historyCount = null;
let batchToggleButton = null;
let editor = null;
let savedIdentity = { name: '', email: '' };
let historyState = null;
let selectedCommit = null;
let batchMode = false;
let batchSelected = new Set();
let batchFocusSha = null;
let batchOptions = { authorMode: 'global', committerMode: 'global', reSign: false };
let historyRequest = 0;
let detailRequest = 0;
let rewriteBusy = false;
let lastAutoRefreshAt = 0;
let commitLimit = 100;
let preferredProjectPath = '';
let syncEditorState = () => {};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function populateProjects() {
  if (!projectSelect) return;
  const previous = projectSelect.value || preferredProjectPath;
  const projects = getProjects().filter((project) => project.path && !project.missing);
  projectSelect.replaceChildren(
    ...projects.map((project) => el('option', {
      value: project.path,
      text: basename(project.path),
      selected: project.path === previous,
    }))
  );
  if (previous && projects.some((project) => project.path === previous)) projectSelect.value = previous;
  if (!projectSelect.value && projects[0]) projectSelect.value = projects[0].path;
  preferredProjectPath = projectSelect.value;
  projectSelect.disabled = projects.length === 0;
}

function buildShell() {
  const projectWrap = el('label', { class: 'commit-project-control' }, [
    el('span', { text: 'Project' }),
  ]);
  projectSelect = el('select', { class: 'commit-project-select', 'aria-label': 'Project' });
  projectSelect.addEventListener('change', async () => {
    batchMode = false;
    batchSelected.clear();
    batchFocusSha = null;
    syncBatchToggle();
    preferredProjectPath = projectSelect.value;
    try {
      await window.api.saveConfig({ commitTool: { projectPath: preferredProjectPath } });
    } catch (error) {
      log(`[commit-tool] could not remember selected project: ${error.message || error}`, true);
    }
    loadHistory();
  });
  projectWrap.appendChild(projectSelect);

  branchLabel = el('span', { class: 'commit-branch-label' });
  toolbar.prepend(projectWrap, branchLabel);

  historyList = el('div', { class: 'commit-history-list' });
  historyCount = el('div', { class: 'commit-history-count' });
  batchToggleButton = el('button', {
    class: 'btn-select-toggle icon-only commit-batch-toggle',
    type: 'button',
    title: 'Select multiple commits',
    'aria-label': 'Select multiple commits',
    'aria-pressed': 'false',
    hidden: true,
    onclick: toggleBatchMode,
  }, [iconElement('listChecks', { size: 13, strokeWidth: 1.9 })]);
  document.getElementById('output-toggle')?.before(batchToggleButton);
  const historyPanel = el('section', { class: 'commit-history-panel' }, [
    el('div', { class: 'commit-panel-heading' }, [
      el('span', { text: 'Commits' }),
      historyCount,
    ]),
    historyList,
  ]);
  editor = el('section', { class: 'commit-editor' });

  root.replaceChildren(el('div', { class: 'commit-main' }, [historyPanel, editor]));
  renderEditorEmpty('Select a commit to inspect its metadata.');
}

async function loadIdentity() {
  let result;
  try {
    result = await window.api.identityGet('global');
  } catch (error) {
    showToast('Could not read global Git identity', error.message || '', { tone: 'error' });
    return;
  }
  if (!result.ok) {
    showToast('Could not read global Git identity', result.error || '', { tone: 'error' });
    return;
  }
  savedIdentity = { name: result.name || '', email: result.email || '' };
  syncEditorState();
}

function renderHistoryLoading() {
  historyList.replaceChildren(el('div', { class: 'commit-tool-state', text: 'Loading commits…' }));
  editor.replaceChildren(el('div', { class: 'commit-tool-state', text: 'Loading metadata…' }));
}

function renderEditorEmpty(message) {
  selectedCommit = null;
  syncEditorState = () => {};
  editor.replaceChildren(el('div', { class: 'commit-tool-state', text: message }));
}

function syncBatchToggle() {
  if (!batchToggleButton) return;
  batchToggleButton.classList.toggle('active', batchMode);
  batchToggleButton.setAttribute('aria-pressed', String(batchMode));
  batchToggleButton.title = batchMode ? 'Exit batch selection' : 'Select multiple commits';
  batchToggleButton.setAttribute('aria-label', batchToggleButton.title);
}

function toggleBatchMode() {
  if (rewriteBusy) return;
  batchMode = !batchMode;
  batchSelected.clear();
  batchFocusSha = null;
  selectedCommit = null;
  syncBatchToggle();
  renderHistory();
  if (batchMode) renderBatchEditor();
  else renderEditorEmpty('Select a commit to inspect its metadata.');
}

function commitRowContent(commit) {
  return el('div', { class: 'commit-row-content' }, [
    el('div', { class: 'commit-row-subject', text: commit.subject }),
    el('div', { class: 'commit-row-meta' }, [
      el('span', { class: 'commit-sha', text: commit.shortSha }),
      el('span', { text: commit.authorName || 'Unknown author' }),
      el('span', { text: formatDate(commit.authorDate) }),
    ]),
    commit.labels.length ? el('div', { class: 'commit-labels' }, commit.labels.slice(0, 3).map((label) => (
      el('span', { class: 'commit-label', text: label.replace(/^HEAD -> /, '') })
    ))) : null,
  ]);
}

function focusBatchRow(row) {
  if (!row || row.classList.contains('disabled')) return;
  historyList.querySelectorAll('.commit-batch-row').forEach((item) => {
    item.tabIndex = item === row ? 0 : -1;
  });
  batchFocusSha = row.dataset.sha || null;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

function moveBatchFocus(row, direction) {
  const rows = Array.from(historyList.querySelectorAll('.commit-batch-row:not(.disabled)'));
  const index = rows.indexOf(row);
  if (index < 0 || !rows.length) return;
  const nextIndex = Math.min(rows.length - 1, Math.max(0, index + direction));
  focusBatchRow(rows[nextIndex]);
}

function renderHistory() {
  const commits = historyState?.commits || [];
  if (batchMode && !commits.some((commit) => commit.sha === batchFocusSha && !commit.isMerge)) {
    batchFocusSha = commits.find((commit) => !commit.isMerge)?.sha || null;
  }
  historyCount.replaceChildren();
  if ((historyState?.totalCount || 0) > 100) {
    const cap = Math.min(historyState.totalCount, 1000);
    const limits = [];
    for (let value = 100; value < cap; value += 100) limits.push(value);
    limits.push(cap);
    if (commitLimit < cap && !limits.includes(commitLimit)) limits.push(commitLimit);
    limits.sort((left, right) => left - right);
    const limitSelect = el('select', {
      class: 'commit-limit-select',
      title: 'Commits to load',
      'aria-label': 'Commits to load',
    }, limits.map((value) => {
      return el('option', { value, text: String(value), selected: value === commitLimit });
    }));
    limitSelect.addEventListener('change', () => {
      commitLimit = Number(limitSelect.value);
      loadHistory(selectedCommit?.sha);
    });
    historyCount.appendChild(limitSelect);
  } else {
    historyCount.appendChild(el('span', { class: 'commit-count', text: String(commits.length) }));
  }
  historyList.replaceChildren();
  if (!commits.length) {
    historyList.appendChild(el('div', { class: 'commit-tool-state', text: 'No commits on this branch.' }));
    return;
  }

  for (const commit of commits) {
    if (batchMode) {
      const checked = batchSelected.has(commit.sha);
      const checkbox = el('input', {
        type: 'checkbox',
        checked,
        disabled: commit.isMerge,
        tabindex: '-1',
        'aria-hidden': 'true',
        'aria-label': `Select ${commit.shortSha} ${commit.subject}`,
      });
      const row = el('label', {
        class: `commit-history-row commit-batch-row${checked ? ' active' : ''}${commit.isMerge ? ' merge disabled' : ''}`,
        title: commit.isMerge ? 'Merge commits cannot be batch rewritten.' : commit.sha,
        role: 'checkbox',
        tabindex: !commit.isMerge && commit.sha === batchFocusSha ? '0' : '-1',
        'data-sha': commit.sha,
        'aria-checked': String(checked),
        'aria-disabled': commit.isMerge ? 'true' : null,
      }, [
        el('span', { class: 'commit-batch-check' }, [
          checkbox,
          el('span', { class: 'checkbox-box' }, [iconElement('check', { size: 9, strokeWidth: 2.1, className: 'checkbox-check' })]),
        ]),
        commitRowContent(commit),
      ]);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) batchSelected.add(commit.sha);
        else batchSelected.delete(commit.sha);
        row.classList.toggle('active', checkbox.checked);
        row.setAttribute('aria-checked', String(checkbox.checked));
        renderBatchEditor();
      });
      row.addEventListener('click', () => focusBatchRow(row));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveBatchFocus(row, event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          checkbox.click();
          focusBatchRow(row);
        }
      });
      historyList.appendChild(row);
      continue;
    }

    const row = el('button', {
      class: `commit-history-row${selectedCommit?.sha === commit.sha ? ' active' : ''}${commit.isMerge ? ' merge' : ''}`,
      type: 'button',
      title: commit.sha,
      onclick: () => selectCommit(commit.sha),
    }, [commitRowContent(commit)]);
    historyList.appendChild(row);
  }
}

async function loadHistory(preferredSha = null) {
  const repoPath = projectSelect?.value;
  const request = ++historyRequest;
  detailRequest += 1;
  historyState = null;
  selectedCommit = null;
  branchLabel.textContent = '';
  if (!repoPath) {
    historyList.replaceChildren(el('div', { class: 'commit-tool-state', text: 'Add a Git project first.' }));
    renderEditorEmpty('No project selected.');
    return;
  }

  renderHistoryLoading();
  let result;
  try {
    result = await window.api.commitToolHistory(repoPath, commitLimit);
  } catch (error) {
    if (request !== historyRequest) return;
    historyList.replaceChildren(el('div', { class: 'commit-tool-error', text: error.message || 'Could not load history.' }));
    renderEditorEmpty('Commit metadata is unavailable.');
    return;
  }
  if (request !== historyRequest) return;
  if (!result.ok) {
    historyList.replaceChildren(el('div', { class: 'commit-tool-error', text: result.error || 'Could not load history.' }));
    renderEditorEmpty('Commit metadata is unavailable.');
    if (result.raw) logDetails(`[commit-tool] ${basename(repoPath)} history failed`, result.raw);
    return;
  }

  historyState = result;
  branchLabel.textContent = result.detached ? 'Detached HEAD' : result.branch;
  branchLabel.classList.toggle('warning', result.detached || result.dirty);
  if (batchMode) {
    const available = new Set(result.commits.map((commit) => commit.sha));
    batchSelected = new Set([...batchSelected].filter((sha) => available.has(sha)));
  }
  renderHistory();
  if (batchMode) {
    renderBatchEditor();
    return;
  }
  const preferred = result.commits.find((commit) => commit.sha === preferredSha);
  if (preferred) await selectCommit(preferred.sha);
  else renderEditorEmpty(result.commits.length ? 'Select a commit to inspect its metadata.' : 'No commits on this branch.');
}

function hasCommitDraft() {
  if (batchMode) {
    return batchSelected.size > 0
      || batchOptions.authorMode !== 'global'
      || batchOptions.committerMode !== 'global'
      || batchOptions.reSign;
  }
  if (!selectedCommit) return false;
  const message = editor?.querySelector('.commit-message-input');
  if (message && message.value !== selectedCommit.message) return true;
  const authorDate = editor?.querySelector('.commit-segmented[aria-label="Author date"] .commit-segment.active');
  if (authorDate && authorDate.dataset.value !== 'preserve') return true;
  const author = editor?.querySelector('.commit-segmented[aria-label="Author identity"] .commit-segment.active');
  if (author && author.dataset.value !== 'global') return true;
  const committer = editor?.querySelector('.commit-segmented[aria-label="Committer identity"] .commit-segment.active');
  if (committer && committer.dataset.value !== 'global') return true;
  return Boolean(editor?.querySelector('.commit-sign-option input:checked'));
}

function autoRefreshHistory() {
  const page = document.getElementById('page-commit-tool');
  if (!page || page.hasAttribute('hidden') || document.hidden || rewriteBusy || hasCommitDraft()) return;
  const now = Date.now();
  if (now - lastAutoRefreshAt < 500) return;
  lastAutoRefreshAt = now;
  loadHistory(selectedCommit?.sha);
}

async function selectCommit(sha) {
  if (batchMode) return;
  const repoPath = projectSelect.value;
  const request = ++detailRequest;
  selectedCommit = historyState?.commits.find((commit) => commit.sha === sha) || { sha };
  renderHistory();
  editor.replaceChildren(el('div', { class: 'commit-tool-state', text: 'Loading metadata…' }));
  let result;
  try {
    result = await window.api.commitToolDetail(repoPath, sha);
  } catch (error) {
    if (request !== detailRequest) return;
    editor.replaceChildren(el('div', { class: 'commit-tool-error', text: error.message || 'Could not load commit metadata.' }));
    return;
  }
  if (request !== detailRequest) return;
  if (!result.ok) {
    editor.replaceChildren(el('div', { class: 'commit-tool-error', text: result.error || 'Could not load commit metadata.' }));
    if (result.raw) logDetails(`[commit-tool] ${sha.slice(0, 7)} metadata failed`, result.raw);
    return;
  }
  selectedCommit = result.commit;
  renderHistory();
  renderCommitEditor();
}

function metadataRow(label, value, className = '') {
  return el('div', { class: `commit-metadata-row ${className}`.trim() }, [
    el('dt', { text: label }),
    el('dd', { text: value || 'None', title: value || 'None' }),
  ]);
}

function segmentedControl(name, options, selected, onChange) {
  const wrap = el('div', { class: 'commit-segmented', role: 'group', 'aria-label': name });
  for (const option of options) {
    const button = el('button', {
      class: `commit-segment${option.value === selected ? ' active' : ''}`,
      type: 'button',
      'data-value': option.value,
      'aria-pressed': String(option.value === selected),
      onclick: () => {
        wrap.querySelectorAll('.commit-segment').forEach((item) => {
          const active = item.dataset.value === option.value;
          item.classList.toggle('active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        onChange(option.value);
      },
    }, [option.label]);
    wrap.appendChild(button);
  }
  return wrap;
}

function selectedBatchCommits() {
  return (historyState?.commits || []).filter((commit) => batchSelected.has(commit.sha));
}

function batchRewriteContext() {
  const selected = selectedBatchCommits();
  const oldest = selected.at(-1) || null;
  const oldestIndex = oldest
    ? historyState.commits.findIndex((commit) => commit.sha === oldest.sha)
    : -1;
  return {
    selected,
    oldest,
    chain: oldestIndex >= 0 ? historyState.commits.slice(0, oldestIndex + 1) : [],
  };
}

function batchRewriteBlocker() {
  if (!historyState) return 'Commit history is unavailable.';
  if (rewriteBusy) return 'Rewrite in progress.';
  if (historyState.detached) return 'Check out a local branch before rewriting.';
  if (historyState.dirty) return `Commit or stash ${historyState.changedCount} working-tree change${historyState.changedCount === 1 ? '' : 's'} first.`;
  const { selected, chain } = batchRewriteContext();
  if (!selected.length) return 'Select at least one commit.';
  if (chain.some((commit) => commit.isMerge)) return 'The rewrite path crosses a merge commit, which is not supported.';
  if (batchOptions.authorMode === 'preserve' && batchOptions.committerMode === 'preserve' && !batchOptions.reSign) {
    return 'Choose a metadata change first.';
  }
  return '';
}

function renderBatchEditor() {
  if (!batchMode || !editor) return;
  selectedCommit = null;
  const { selected } = batchRewriteContext();
  const count = selected.length;
  if (!historyState?.signing.configured) batchOptions.reSign = false;

  const authorControl = segmentedControl('Author identity', [
    { value: 'preserve', label: 'Preserve' },
    { value: 'global', label: 'Use global' },
  ], batchOptions.authorMode, (value) => {
    batchOptions.authorMode = value;
    syncBatchState();
  });
  const committerControl = segmentedControl('Committer identity', [
    { value: 'preserve', label: 'Preserve' },
    { value: 'global', label: 'Use global' },
  ], batchOptions.committerMode, (value) => {
    batchOptions.committerMode = value;
    syncBatchState();
  });
  const signInput = el('input', { type: 'checkbox', checked: batchOptions.reSign });
  signInput.disabled = !historyState?.signing.configured;
  signInput.addEventListener('change', () => {
    batchOptions.reSign = signInput.checked;
    syncBatchState();
  });
  const signingLabel = historyState?.signing.configured
    ? `Re-sign rewritten commits (${historyState.signing.format || 'openpgp'})`
    : 'Re-sign rewritten commits (signing is not configured)';

  const rewriteButton = el('button', {
    class: 'btn btn-primary commit-rewrite-btn',
    onclick: rewriteBatchCommits,
  }, [`Rewrite ${count} selected`]);
  const blocker = el('div', { class: 'commit-rewrite-blocker' });
  const syncBatchState = () => {
    const reason = batchRewriteBlocker();
    rewriteButton.disabled = Boolean(reason);
    rewriteButton.textContent = `Rewrite ${batchSelected.size} selected`;
    blocker.textContent = reason;
    blocker.toggleAttribute('hidden', !reason);
  };
  syncEditorState = syncBatchState;

  const editorScroll = el('div', { class: 'commit-editor-scroll' }, [
    el('div', { class: 'commit-editor-head' }, [
      el('div', { class: 'commit-editor-heading-content' }, [
        el('div', { class: 'commit-editor-subject', text: 'Batch rewrite' }),
        el('div', { class: 'commit-editor-sha', text: `${count} commit${count === 1 ? '' : 's'} selected` }),
      ]),
    ]),
    el('section', { class: 'commit-batch-settings' }, [
      el('div', { class: 'commit-control-row' }, [
        el('span', { class: 'commit-control-label', text: 'Author identity' }),
        authorControl,
      ]),
      el('div', { class: 'commit-control-row' }, [
        el('span', { class: 'commit-control-label', text: 'Committer identity' }),
        committerControl,
      ]),
      el('label', { class: `commit-sign-option${signInput.disabled ? ' disabled' : ''}` }, [
        signInput,
        el('span', { class: 'checkbox-box' }, [iconElement('check', { size: 9, strokeWidth: 2.1, className: 'checkbox-check' })]),
        el('span', { text: signingLabel }),
      ]),
    ]),
  ]);
  editor.replaceChildren(editorScroll, el('div', { class: 'commit-rewrite-footer' }, [blocker, rewriteButton]));
  syncBatchState();
}

async function rewriteBatchCommits() {
  const reason = batchRewriteBlocker();
  if (reason || rewriteBusy) {
    if (reason) showToast('Commits cannot be rewritten', reason, { tone: 'error' });
    return;
  }
  const needsGlobalIdentity = batchOptions.authorMode === 'global' || batchOptions.committerMode === 'global';
  if (needsGlobalIdentity && (!savedIdentity.name || !savedIdentity.email)) {
    showToast('Global Git identity required', 'Set the global name and email in Identity Tool before using this option.', { tone: 'error' });
    return;
  }

  const { selected, oldest, chain } = batchRewriteContext();
  const selectedCount = selected.length;
  const changes = [
    `Author identity: ${batchOptions.authorMode === 'global' ? `${savedIdentity.name} <${savedIdentity.email}>` : 'Preserve'}`,
    `Committer identity: ${batchOptions.committerMode === 'global' ? `${savedIdentity.name} <${savedIdentity.email}>` : 'Preserve'}`,
    'Commit messages: Preserve',
    'Author dates: Preserve',
    batchOptions.reSign ? 'Signatures: Create a new signature for every rewritten commit' : 'Signatures: Rewritten commits will be unsigned',
  ];
  const confirmed = await confirmDialog({
    message: `Rewrite ${selectedCount} selected commit${selectedCount === 1 ? '' : 's'}?`,
    detail: [
      ...changes,
      '',
      `${chain.length} commit hash${chain.length === 1 ? '' : 'es'} will change from ${oldest.shortSha} through HEAD.`,
      `Only local branch ${historyState.branch} will move; remote branches and tags will not.`,
    ].join('\n'),
    confirmText: 'Rewrite selected',
    cancelText: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  rewriteBusy = true;
  syncEditorState();
  try {
    let result;
    try {
      result = await window.api.commitToolRewrite({
        repoPath: projectSelect.value,
        commit: oldest.sha,
        commits: selected.map((commit) => commit.sha),
        authorMode: batchOptions.authorMode,
        authorDateMode: 'preserve',
        committerMode: batchOptions.committerMode,
        reSign: batchOptions.reSign,
      });
    } catch (error) {
      showToast('Batch rewrite failed', error.message || '', { tone: 'error', duration: 7000 });
      return;
    }
    if (!result.ok) {
      showToast('Batch rewrite failed', result.error || '', { tone: 'error', duration: 7000 });
      if (result.raw) logDetails('[commit-tool] batch rewrite failed', result.raw);
      return;
    }

    if (result.warning) {
      showToast('Commits rewritten with cleanup warning', result.warning, { tone: 'warning', duration: 8000 });
      log(`[commit-tool] ${result.warning}`, true);
    } else {
      showToast('Commits rewritten', `${selectedCount} selected; ${result.rewrittenCount} hashes updated on ${result.branch}`);
    }
    log(`[commit-tool] batch rewrote ${selectedCount} selected commit${selectedCount === 1 ? '' : 's'} across ${result.rewrittenCount} hash${result.rewrittenCount === 1 ? '' : 'es'} on ${result.branch}`, true);
    batchSelected.clear();
    batchFocusSha = null;
    await refreshAll({ force: true });
    await loadHistory();
  } finally {
    rewriteBusy = false;
    syncEditorState();
  }
}

function rewriteBlocker() {
  if (!selectedCommit || !historyState) return 'Select a commit first.';
  if (rewriteBusy) return 'Rewrite in progress.';
  if (historyState.detached) return 'Check out a local branch before rewriting.';
  if (historyState.dirty) return `Commit or stash ${historyState.changedCount} working-tree change${historyState.changedCount === 1 ? '' : 's'} first.`;
  if (selectedCommit.isMerge) return 'Merge commits are not supported.';
  if (!selectedCommit.isAncestor) return 'This commit is not an ancestor of the current branch.';
  const message = editor?.querySelector('.commit-message-input')?.value.trim();
  if (!message) return 'The commit message cannot be empty.';
  const customInput = editor?.querySelector('.commit-custom-date');
  if (customInput && !customInput.hidden && !customInput.value) return 'Choose a custom author date.';
  return '';
}

function renderCommitEditor() {
  const commit = selectedCommit;
  const authorMode = { value: 'global' };
  const authorDateMode = { value: 'preserve' };
  const committerMode = { value: 'global' };

  const messageInput = el('textarea', {
    class: 'commit-message-input',
    rows: '5',
    spellcheck: 'true',
    'aria-label': 'Commit message',
  });
  messageInput.value = commit.message;

  const customDate = el('input', {
    class: 'commit-custom-date',
    type: 'datetime-local',
    value: localDateTimeValue(commit.authorDate),
    hidden: true,
    'aria-label': 'Custom author date',
  });
  const authorDateControl = segmentedControl('Author date', [
    { value: 'preserve', label: 'Preserve' },
    { value: 'current', label: 'Current' },
    { value: 'custom', label: 'Custom' },
  ], authorDateMode.value, (value) => {
    authorDateMode.value = value;
    customDate.toggleAttribute('hidden', value !== 'custom');
    syncRewriteButton();
  });

  const authorIdentityControl = segmentedControl('Author identity', [
    { value: 'preserve', label: 'Preserve' },
    { value: 'global', label: 'Use global' },
  ], authorMode.value, (value) => {
    authorMode.value = value;
    syncRewriteButton();
  });

  const committerControl = segmentedControl('Committer identity', [
    { value: 'preserve', label: 'Preserve' },
    { value: 'global', label: 'Use global' },
  ], committerMode.value, (value) => {
    committerMode.value = value;
    syncRewriteButton();
  });

  const signInput = el('input', { type: 'checkbox' });
  signInput.disabled = !historyState.signing.configured;
  const signingLabel = historyState.signing.configured
    ? `Re-sign rewritten commits (${historyState.signing.format || 'openpgp'})`
    : 'Re-sign rewritten commits (signing is not configured)';

  const rewriteButton = el('button', {
    class: 'btn btn-primary commit-rewrite-btn',
    onclick: () => rewriteCommit({ authorMode, authorDateMode, committerMode, customDate, signInput, messageInput }),
  }, ['Rewrite commit']);
  const blocker = el('div', { class: 'commit-rewrite-blocker' });
  const syncRewriteButton = () => {
    const reason = rewriteBlocker();
    rewriteButton.disabled = Boolean(reason);
    blocker.textContent = reason;
    blocker.toggleAttribute('hidden', !reason);
  };
  syncEditorState = syncRewriteButton;
  messageInput.addEventListener('input', syncRewriteButton);
  customDate.addEventListener('input', syncRewriteButton);

  const labels = commit.labels.length
    ? el('div', { class: 'commit-labels commit-editor-labels' }, commit.labels.map((label) => el('span', {
      class: 'commit-label',
      text: label.replace(/^HEAD -> /, ''),
    })))
    : null;

  const committerSettings = el('section', { class: 'commit-committer-settings' }, [
    el('div', { class: 'commit-settings-title', text: 'Committer' }),
    el('dl', { class: 'commit-metadata compact' }, [
      metadataRow('Identity', `${commit.committerName} <${commit.committerEmail}>`),
      metadataRow('Date', formatDate(commit.committerDate)),
      metadataRow('Signature', commit.signature === 'N' ? 'Unsigned' : 'Signed'),
    ]),
    el('div', { class: 'commit-control-row' }, [
      el('span', { class: 'commit-control-label', text: 'Committer identity' }),
      committerControl,
    ]),
    el('label', { class: `commit-sign-option${signInput.disabled ? ' disabled' : ''}` }, [
      signInput,
      el('span', { class: 'checkbox-box' }, [iconElement('check', { size: 9, strokeWidth: 2.1, className: 'checkbox-check' })]),
      el('span', { text: signingLabel }),
    ]),
  ]);

  const editorScroll = el('div', { class: 'commit-editor-scroll' }, [
    el('div', { class: 'commit-editor-head' }, [
      el('div', { class: 'commit-editor-heading-content' }, [
        el('div', { class: 'commit-editor-subject', text: commit.message.split('\n')[0] || '(no commit message)' }),
        el('div', { class: 'commit-editor-sha', text: commit.sha }),
        labels,
      ]),
    ]),
    el('dl', { class: 'commit-metadata commit-primary-metadata' }, [
      metadataRow('Commit', `${commit.sha} [${commit.shortSha}]`, 'wide'),
      metadataRow('Parents', commit.parents.map((parent) => parent.slice(0, 10)).join('  ') || 'Root commit'),
      metadataRow('Author', `${commit.authorName} <${commit.authorEmail}>`),
      metadataRow('Date', formatDate(commit.authorDate)),
    ]),
    el('label', { class: 'commit-message-field' }, [
      el('span', { text: 'Commit message' }),
      messageInput,
    ]),
    el('div', { class: 'commit-control-row' }, [
      el('span', { class: 'commit-control-label', text: 'Author identity' }),
      authorIdentityControl,
    ]),
    el('div', { class: 'commit-control-row author-date-row' }, [
      el('span', { class: 'commit-control-label', text: 'Author date' }),
      el('div', { class: 'author-date-controls' }, [authorDateControl, customDate]),
    ]),
    committerSettings,
  ]);
  editor.replaceChildren(editorScroll, el('div', { class: 'commit-rewrite-footer' }, [blocker, rewriteButton]));
  syncRewriteButton();
}

async function rewriteCommit({ authorMode, authorDateMode, committerMode, customDate, signInput, messageInput }) {
  const reason = rewriteBlocker();
  if (reason || rewriteBusy) {
    if (reason) showToast('Commit cannot be rewritten', reason, { tone: 'error' });
    return;
  }
  const needsGlobalIdentity = authorMode.value === 'global' || committerMode.value === 'global';
  if (needsGlobalIdentity && (!savedIdentity.name || !savedIdentity.email)) {
    showToast('Global Git identity required', 'Set the global name and email in Identity Tool before using this option.', { tone: 'error' });
    return;
  }

  const commit = selectedCommit;
  const descendants = commit.descendantCount;
  const changes = [];
  const addChange = (label, from, to) => {
    if (from === to) return;
    const multiline = String(from).includes('\n') || String(to).includes('\n');
    if (multiline) {
      const indent = (value) => String(value).split('\n').map((line) => `    ${line}`).join('\n');
      changes.push(`${label}:\n  From:\n${indent(from)}\n  To:\n${indent(to)}`);
    } else {
      changes.push(`${label}: ${from} -> ${to}`);
    }
  };

  const oldAuthor = `${commit.authorName} <${commit.authorEmail}>`;
  const newAuthor = authorMode.value === 'global'
    ? `${savedIdentity.name} <${savedIdentity.email}>`
    : oldAuthor;
  addChange('Author', oldAuthor, newAuthor);

  let newAuthorDate = formatDate(commit.authorDate);
  if (authorDateMode.value === 'current') newAuthorDate = 'Current time';
  if (authorDateMode.value === 'custom') newAuthorDate = formatDate(customDate.value);
  addChange('Author date', formatDate(commit.authorDate), newAuthorDate);

  const oldCommitter = `${commit.committerName} <${commit.committerEmail}>`;
  const newCommitter = committerMode.value === 'global'
    ? `${savedIdentity.name} <${savedIdentity.email}>`
    : oldCommitter;
  addChange('Committer', oldCommitter, newCommitter);
  if (committerMode.value === 'global') {
    addChange('Committer date', formatDate(commit.committerDate), 'Current time');
  }

  addChange('Message', commit.message, messageInput.value);
  const currentSignature = commit.signature === 'N' ? 'Unsigned' : 'Signed';
  const nextSignature = signInput.checked ? 'New signature' : 'Unsigned';
  addChange('Selected commit signature', currentSignature, nextSignature);

  const confirmed = await confirmDialog({
    message: `Rewrite ${commit.shortSha}${descendants ? ` and ${descendants} newer commit${descendants === 1 ? '' : 's'}` : ''}?`,
    detail: [
      'Metadata changes:',
      ...(changes.length ? changes : ['No selected metadata values will change.']),
      '',
      signInput.checked
        ? 'Signatures: create a new signature for every rewritten commit.'
        : 'Signatures: rewritten commits will be unsigned.',
      `${descendants + 1} commit hash${descendants === 0 ? '' : 'es'} will change. Only local branch ${historyState.branch} will move; remote branches and tags will not.`,
      descendants ? 'Newer commit metadata is preserved, but its parent link and SHA will change.' : '',
    ].filter(Boolean).join('\n'),
    confirmText: 'Rewrite commit',
    cancelText: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  rewriteBusy = true;
  const rewriteButton = editor.querySelector('.commit-rewrite-btn');
  if (rewriteButton) rewriteButton.disabled = true;
  try {
    const customDateValue = authorDateMode.value === 'custom'
      ? new Date(customDate.value).toISOString()
      : '';
    let result;
    try {
      result = await window.api.commitToolRewrite({
        repoPath: projectSelect.value,
        commit: commit.sha,
        message: messageInput.value,
        authorMode: authorMode.value,
        authorDateMode: authorDateMode.value,
        authorDate: customDateValue,
        committerMode: committerMode.value,
        reSign: signInput.checked,
      });
    } catch (error) {
      showToast('Commit rewrite failed', error.message || '', { tone: 'error', duration: 7000 });
      return;
    }
    if (!result.ok) {
      showToast('Commit rewrite failed', result.error || '', { tone: 'error', duration: 7000 });
      if (result.raw) logDetails(`[commit-tool] rewrite ${commit.shortSha} failed`, result.raw);
      return;
    }

    if (result.warning) {
      showToast('Commit rewritten with cleanup warning', result.warning, { tone: 'warning', duration: 8000 });
      log(`[commit-tool] ${result.warning}`, true);
    } else {
      showToast('Commit rewritten', `${commit.shortSha} → ${result.newCommit.slice(0, 7)} on ${result.branch}`);
    }
    log(`[commit-tool] rewrote ${result.rewrittenCount} commit${result.rewrittenCount === 1 ? '' : 's'} on ${result.branch}; ${commit.shortSha} → ${result.newCommit.slice(0, 7)}`, true);
    await refreshAll({ force: true });
    await loadHistory(result.newCommit);
  } finally {
    rewriteBusy = false;
    syncEditorState();
  }
}

export function setupCommitTool(initialConfig = {}) {
  root = document.getElementById('commit-tool-workspace');
  toolbar = document.querySelector('#page-commit-tool .commit-tool-toolbar');
  if (!root || !toolbar) return;
  preferredProjectPath = initialConfig.projectPath || '';
  buildShell();
  populateProjects();
  loadIdentity();
  loadHistory();

  window.addEventListener('pcs:tab-change', (event) => {
    const commitToolActive = event.detail?.name === 'commit-tool';
    batchToggleButton?.toggleAttribute('hidden', !commitToolActive);
    if (!commitToolActive) return;
    const previousProject = projectSelect.value;
    populateProjects();
    loadIdentity();
    if (previousProject !== projectSelect.value) {
      batchMode = false;
      batchSelected.clear();
      batchFocusSha = null;
      syncBatchToggle();
      loadHistory();
    } else {
      autoRefreshHistory();
    }
  });
  window.addEventListener('focus', autoRefreshHistory);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) autoRefreshHistory();
  });
}
