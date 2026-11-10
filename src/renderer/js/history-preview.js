import { basename } from './util.js';
import { iconElement } from './icons.js';
import { layoutCommitGraph } from './commit-graph.mjs';
import { createHistoryDiffView } from './history-diff-view.js';
import { refreshBranches } from './branches.js';
import { refreshProjectRow } from './render-row.js';
import { persist } from './persist.js';
import { logDetails } from './log.js';

const NO_ACTIVE_PREVIEW = () => {};
let dismissActivePreview = NO_ACTIVE_PREVIEW;
let previewSequence = 0;

export function releaseHistoryPreview(owner) {
  if (dismissActivePreview === owner) dismissActivePreview = NO_ACTIVE_PREVIEW;
}

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function reconcileChildren(parent, children) {
  children.forEach((child, index) => {
    if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null);
  });
  while (parent.children.length > children.length) parent.lastElementChild.remove();
}

function iconButton(name, label) {
  const button = element('button', 'history-icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(iconElement(name, { size: 14 }));
  return button;
}

function dateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function readPreview(request) {
  try {
    return await request();
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

const GRAPH_COLORS = [
  'var(--branch-color)', 'var(--graph-teal)', 'var(--graph-blue)',
  'var(--graph-amber)', 'var(--graph-pink)', 'var(--graph-slate)',
];
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const GRAPH_LANE_WIDTH = 10;
const GRAPH_PADDING = 10;

function drawCommitGraph(list, commits, buttons, layout) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.classList.add('history-commit-graph');
  svg.setAttribute('aria-hidden', 'true');
  const graphWidth = layout.laneCount * GRAPH_LANE_WIDTH + GRAPH_PADDING;
  const height = list.offsetHeight;
  svg.setAttribute('width', graphWidth);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${graphWidth} ${height}`);
  const x = (lane) => GRAPH_PADDING + lane * GRAPH_LANE_WIDTH;
  const path = (data, color, dashed = false) => {
    const node = document.createElementNS(SVG_NAMESPACE, 'path');
    node.setAttribute('d', data);
    node.setAttribute('stroke', GRAPH_COLORS[color % GRAPH_COLORS.length]);
    node.setAttribute('stroke-width', '1.4');
    node.setAttribute('fill', 'none');
    if (dashed) node.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(node);
  };

  for (const [index, row] of layout.rows.entries()) {
    const button = buttons[index];
    const top = button.offsetTop;
    const bottom = top + button.offsetHeight;
    const middle = top + button.offsetHeight / 2;
    for (const lane of row.through) {
      path(`M ${x(lane.lane)} ${top} V ${bottom}`, lane.color, lane.dashed);
    }
    if (row.incoming) {
      path(`M ${x(row.lane)} ${top} V ${middle}`, row.color, row.incomingDashed);
    }
    for (const edge of row.edges) {
      const bend = middle + (bottom - middle) / 2;
      path(`M ${x(row.lane)} ${middle} C ${x(row.lane)} ${bend}, ${x(edge.lane)} ${bend}, ${x(edge.lane)} ${bottom}`, edge.color, commits[index].workingTree);
    }
  }

  for (const [index, row] of layout.rows.entries()) {
    const button = buttons[index];
    const node = document.createElementNS(SVG_NAMESPACE, 'circle');
    node.setAttribute('cx', x(row.lane));
    node.setAttribute('cy', button.offsetTop + button.offsetHeight / 2);
    node.setAttribute('r', commits[index].parents.length > 1 ? '5' : '3.8');
    const color = GRAPH_COLORS[row.color % GRAPH_COLORS.length];
    node.setAttribute('stroke', color);
    node.setAttribute('stroke-width', '2');
    node.setAttribute('fill', commits[index].workingTree ? 'var(--dropdown-bg)' : color);
    if (commits[index].parents.length > 1) {
      node.setAttribute('fill', 'var(--surface)');
    }
    svg.appendChild(node);
  }
  list.querySelector('.history-commit-graph')?.remove();
  list.appendChild(svg);
}

function createPaneDivider(container, firstPane, property, label, minFirst, minLast, stackedBelow = 0) {
  const divider = element('div', 'history-pane-divider');
  divider.tabIndex = 0;
  divider.title = `${label} · drag to resize, double-click to reset`;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', label);
  let drag = null;

  const metrics = () => {
    const stacked = typeof stackedBelow === 'function'
      ? stackedBelow()
      : stackedBelow > 0 && window.innerWidth <= stackedBelow;
    const rect = container.getBoundingClientRect();
    const first = firstPane.getBoundingClientRect();
    return { stacked, total: stacked ? rect.height : rect.width, size: stacked ? first.height : first.width };
  };
  const sync = () => {
    const { stacked, total, size } = metrics();
    divider.dataset.orientation = stacked ? 'horizontal' : 'vertical';
    divider.setAttribute('aria-orientation', divider.dataset.orientation);
    divider.setAttribute('aria-valuenow', String(Math.round(size / Math.max(total, 1) * 100)));
  };
  const resize = (size) => {
    const { total } = metrics();
    if (total <= 0) return;
    const minimum = Math.min(minFirst, total * 0.35);
    const maximum = Math.max(minimum, total - Math.min(minLast, total * 0.45) - 8);
    const bounded = Math.max(minimum, Math.min(maximum, size));
    container.style.setProperty(property, `${bounded / total * 100}%`);
    sync();
  };
  const finishDrag = () => {
    if (!drag) return;
    const pointerId = drag.pointerId;
    drag = null;
    divider.classList.remove('dragging');
    if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
  };
  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    const { stacked, size } = metrics();
    drag = { pointerId: event.pointerId, position: stacked ? event.clientY : event.clientX, size, stacked };
    divider.focus();
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const position = drag.stacked ? event.clientY : event.clientX;
    resize(drag.size + position - drag.position);
  });
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);
  divider.addEventListener('lostpointercapture', finishDrag);
  divider.addEventListener('dblclick', () => {
    container.style.removeProperty(property);
    sync();
  });
  divider.addEventListener('keydown', (event) => {
    const { stacked, size } = metrics();
    const backward = stacked ? 'ArrowUp' : 'ArrowLeft';
    const forward = stacked ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== backward && event.key !== forward) return;
    event.preventDefault();
    resize(size + (event.key === forward ? 1 : -1) * (event.shiftKey ? 40 : 10));
  });
  const observer = new ResizeObserver(sync);
  observer.observe(container);
  return {
    element: divider,
    disconnect: () => {
      finishDrag();
      observer.disconnect();
    },
  };
}

export function openHistoryPreview(project, trigger, {
  container = null, navigation = null, onRequestClose = null, onBusyChange = null, autofocus = true, initialState = null,
} = {}) {
  if (!container && dismissActivePreview() === false) return null;
  const overlay = container || element('div', 'modal-overlay history-preview-overlay');
  const card = element('section', 'modal-card history-preview-card');
  card.id = `history-preview-${++previewSequence}`;
  card.setAttribute('role', navigation ? 'tabpanel' : 'dialog');
  if (!navigation) card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', `${card.id}-title`);
  if (navigation && !container) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Git manager');
  }

  const header = element('header', 'history-preview-header');
  const windowGrip = element('span', 'history-window-grip');
  windowGrip.title = 'Drag to move window';
  windowGrip.setAttribute('aria-hidden', 'true');
  windowGrip.appendChild(iconElement('gripVertical', { size: 16 }));
  const heading = element('div', 'history-preview-heading');
  const title = element('h2', '', `${navigation ? 'Git manager' : 'Git history'} · ${basename(project.path)}`);
  title.id = `${card.id}-title`;
  const branch = element('span', 'history-preview-branch', 'Loading…');
  const repoPath = element('div', 'history-preview-path', project.path);
  repoPath.title = project.path;
  heading.append(title, repoPath);
  const refresh = iconButton('refresh', 'Refresh history');
  const closeButton = iconButton('x', navigation ? 'Close Git manager' : 'Close history preview');
  header.append(windowGrip, heading, branch, refresh, closeButton);

  const body = element('div', 'history-preview-body');
  const timeline = element('nav', 'history-preview-timeline');
  timeline.setAttribute('aria-label', 'Working tree and recent commits');
  const detail = element('section', 'history-preview-detail');
  const metadata = element('div', 'history-preview-metadata');
  const worktreeToolbar = element('div', 'history-worktree-toolbar');
  worktreeToolbar.hidden = true;
  const pendingLabel = element('span', '', 'Pending files');
  const fileSearch = element('input', 'history-file-search');
  fileSearch.type = 'search';
  fileSearch.placeholder = 'Search files';
  fileSearch.setAttribute('aria-label', 'Search pending files');
  worktreeToolbar.append(pendingLabel, fileSearch);
  const content = element('div', 'history-preview-content');
  const files = element('div', 'history-preview-files');
  files.setAttribute('aria-label', 'Changed files');
  const diffPanel = element('div', 'history-preview-diff-panel');
  const diffTitle = element('div', 'history-preview-diff-title', 'File preview');
  const diff = element('pre', 'history-preview-diff');
  diff.setAttribute('tabindex', '0');
  diff.setAttribute('aria-label', 'File diff');
  const diffView = createHistoryDiffView(diff);
  const fileDivider = createPaneDivider(content, files, '--history-files-size', 'Resize file list and diff', 110, 180,
    () => window.innerWidth <= 640 && !body.classList.contains('is-working'));
  const stagedPane = element('section', 'history-worktree-group');
  const unstagedPane = element('section', 'history-worktree-group');
  const stagingDivider = createPaneDivider(files, stagedPane, '--history-staged-size', 'Resize staged and unstaged files', 70, 90, Infinity);
  content.append(files, fileDivider.element, diffPanel);
  diffPanel.append(diffTitle, diff);
  const commitForm = element('form', 'history-commit-form');
  commitForm.hidden = true;
  const commitMessage = element('textarea', 'history-commit-message');
  commitMessage.placeholder = 'Commit message…';
  commitMessage.rows = 3;
  commitMessage.maxLength = 65536;
  commitMessage.value = initialState?.draft || '';
  fileSearch.value = initialState?.search || '';
  commitMessage.setAttribute('aria-label', 'Commit message');
  const commitActions = element('div', 'history-commit-actions');
  const actionStatus = element('div', 'history-action-status');
  actionStatus.setAttribute('role', 'status');
  const commitButton = element('button', 'btn btn-primary history-commit-button', 'Commit staged');
  commitButton.type = 'submit';
  commitActions.append(actionStatus, commitButton);
  commitForm.append(commitMessage, commitActions);
  detail.append(metadata, worktreeToolbar, content, commitForm);
  const timelineDivider = createPaneDivider(body, timeline, '--history-timeline-size', 'Resize commit list', 180, 280);
  body.append(timeline, timelineDivider.element, detail);
  const footer = element('div', 'history-preview-footer');
  card.append(header);
  if (navigation) card.appendChild(navigation);
  card.append(body, footer);
  overlay.appendChild(card);
  if (!container) document.body.appendChild(overlay);

  let closed = false;
  let overview = null;
  let loadVersion = 0;
  let detailVersion = 0;
  let patchVersion = 0;
  let graphObserver = null;
  let mutationBusy = false;
  let loading = false;
  let working = false;
  let selectedFile = null;
  let selectedCommit = null;
  let workingTreeEntry = null;
  let firstCommitEntry = null;
  let restoration = initialState;
  let refreshFailed = false;
  const workingRows = new Map();
  const workingGroups = new Map();

  if (initialState?.paneSizes) {
    const sizes = initialState.paneSizes;
    if (sizes.timeline) body.style.setProperty('--history-timeline-size', sizes.timeline);
    if (sizes.files) content.style.setProperty('--history-files-size', sizes.files);
    if (sizes.staged) files.style.setProperty('--history-staged-size', sizes.staged);
  }
  const scrollPosition = (node) => ({ top: node?.scrollTop || 0, left: node?.scrollLeft || 0 });
  const getState = () => ({
    draft: commitMessage.value,
    search: fileSearch.value,
    selection: overview ? (working ? 'working-tree' : selectedCommit?.sha || null) : null,
    selectedFile: selectedFile ? { ...selectedFile } : null,
    paneSizes: {
      timeline: body.style.getPropertyValue('--history-timeline-size'),
      files: content.style.getPropertyValue('--history-files-size'),
      staged: files.style.getPropertyValue('--history-staged-size'),
    },
    scroll: {
      timeline: scrollPosition(timeline), files: scrollPosition(files), diff: scrollPosition(diff),
      staged: scrollPosition(workingGroups.get('staged')?.list),
      unstaged: scrollPosition(workingGroups.get('unstaged')?.list),
    },
  });
  const restoreViewport = (saved) => {
    for (const [key, node] of [
      ['timeline', timeline], ['files', files], ['diff', diff],
      ['staged', workingGroups.get('staged')?.list], ['unstaged', workingGroups.get('unstaged')?.list],
    ]) {
      if (!node || !saved?.scroll?.[key]) continue;
      node.scrollTop = saved.scroll[key].top;
      node.scrollLeft = saved.scroll[key].left;
    }
    diffView.refresh();
  };
  const close = ({ restoreFocus = true, keepWindow = false } = {}) => {
    if (closed) return true;
    if (mutationBusy) return false;
    closed = true;
    loadVersion += 1;
    detailVersion += 1;
    patchVersion += 1;
    graphObserver?.disconnect();
    graphObserver = null;
    diffView.destroy();
    fileDivider.disconnect();
    timelineDivider.disconnect();
    stagingDivider.disconnect();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('focus', onWindowFocus);
    overlay.removeEventListener('click', onOverlayClick);
    if (!keepWindow) releaseHistoryPreview(requestClose);
    overview = null;
    selectedCommit = null;
    selectedFile = null;
    restoration = null;
    workingRows.clear();
    workingGroups.clear();
    timeline.replaceChildren();
    metadata.replaceChildren();
    files.replaceChildren();
    stagedPane.replaceChildren();
    unstagedPane.replaceChildren();
    commitMessage.value = '';
    card.replaceChildren();
    if (container || keepWindow) card.remove();
    else overlay.remove();
    if (restoreFocus) {
      const focusTarget = trigger?.isConnected ? trigger : document.querySelector(
        `.project-row[data-path="${CSS.escape(project.path)}"] .btn-history`
      );
      focusTarget?.focus();
    }
    return true;
  };
  const requestClose = onRequestClose || close;
  const onOverlayClick = (event) => { if (event.target === overlay) requestClose(); };
  if (!container) dismissActivePreview = requestClose;
  const onKeydown = (event) => {
    if (closed || card.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    } else if (event.key === 'Tab') {
      const focusable = [...card.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter((node) => node.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  function showDiff(text, plainText = true, numbered = false, truncated = false) {
    diffView.show(text, { plainText, numbered, truncated });
  }

  async function selectFile(file, commit = '', { preservePreview = false } = {}) {
    const request = ++patchVersion;
    const currentDetail = detailVersion;
    const keepScroll = preservePreview && selectedFile?.path === file.path;
    selectedFile = { path: file.path, kind: file.kind };
    files.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('active', button === file.button);
      button.setAttribute('aria-pressed', String(button === file.button));
    });
    diffTitle.textContent = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
    diffTitle.title = diffTitle.textContent;
    diff.setAttribute('aria-busy', 'true');
    if (!keepScroll) showDiff('Loading file preview…');
    const result = await readPreview(() => window.api.gitHistoryPatch({
      repoPath: project.path,
      commit,
      filePath: file.path,
      originalPath: file.originalPath,
      kind: file.kind || 'unstaged',
    }));
    if (closed || request !== patchVersion || currentDetail !== detailVersion) return;
    diff.setAttribute('aria-busy', 'false');
    if (!result?.ok) {
      showDiff(result?.error || 'Could not load this file.');
      return;
    }
    const scrollTop = keepScroll ? diff.scrollTop : 0;
    const scrollLeft = keepScroll ? diff.scrollLeft : 0;
    showDiff(result.patch || 'No textual changes to display.', Boolean(result.plainText || result.binary), Boolean(result.patch) && !result.binary, Boolean(result.truncated));
    diff.scrollTop = scrollTop;
    diff.scrollLeft = scrollLeft;
    diffView.refresh();
  }

  function stagingCheckbox(checked, label, entries, staged) {
    const wrapper = element('label', 'history-stage-toggle');
    wrapper.title = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.empty = String(entries.length === 0);
    input.setAttribute('aria-label', label);
    const box = element('span', 'checkbox-box');
    box.appendChild(iconElement('check', { size: 9, className: 'checkbox-check' }));
    wrapper.append(input, box);
    input.addEventListener('change', () => changeStaging(entries, staged));
    return wrapper;
  }

  function syncActions() {
    const stagedCount = overview?.changes.filter((file) => file.staged).length || 0;
    closeButton.disabled = mutationBusy;
    refresh.disabled = mutationBusy || loading;
    commitMessage.disabled = mutationBusy;
    fileSearch.disabled = mutationBusy || loading || !overview?.commitSnapshot;
    commitButton.textContent = mutationBusy ? 'Working…' : `Commit staged (${stagedCount})`;
    commitButton.disabled = mutationBusy || loading || !overview?.commitSnapshot || stagedCount === 0 || !commitMessage.value.trim();
    files.querySelectorAll('input').forEach((input) => {
      input.disabled = mutationBusy || loading || !overview?.commitSnapshot || input.dataset.empty === 'true';
    });
    files.querySelectorAll('button').forEach((button) => { button.disabled = mutationBusy || loading; });
    timeline.querySelectorAll('button').forEach((button) => { button.disabled = mutationBusy || loading || button.dataset.empty === 'true'; });
    if (!closed && !card.hidden) onBusyChange?.(mutationBusy);
  }

  async function changeStaging(entries, staged) {
    if (mutationBusy || loading || !entries.length) return;
    mutationBusy = true;
    actionStatus.classList.remove('error');
    actionStatus.textContent = staged ? 'Staging selected files…' : 'Unstaging selected files…';
    syncActions();
    const paths = [];
    for (const file of entries) {
      paths.push(file.path);
      if (file.originalPath && (!staged || /[RC]/.test(file.status[1]))) paths.push(file.originalPath);
    }
    try {
      const result = await readPreview(() => window.api.gitHistorySetStaging({ repoPath: project.path, paths, staged }));
      actionStatus.textContent = result?.ok
        ? `${entries.length} file${entries.length === 1 ? '' : 's'} ${staged ? 'staged' : 'unstaged'}.`
        : result?.raw || result?.error || 'Could not update staged files.';
      actionStatus.classList.toggle('error', !result?.ok);
      await load({ preferredFile: selectedFile });
    } finally {
      mutationBusy = false;
      syncActions();
    }
  }

  async function commitStaged() {
    if (commitButton.disabled || mutationBusy || loading) return;
    mutationBusy = true;
    actionStatus.classList.remove('error');
    actionStatus.textContent = 'Committing staged files…';
    syncActions();
    try {
      const result = await readPreview(() => window.api.gitHistoryCommitStaged(
        project.path, commitMessage.value, overview.commitSnapshot
      ));
      if (result?.ok) {
        commitMessage.value = '';
        actionStatus.textContent = 'Commit created.';
        void refreshBranches(project).then(() => {
          refreshProjectRow(project);
          void persist();
        });
      } else {
        actionStatus.textContent = result?.raw || result?.error || 'The commit could not be created.';
        actionStatus.classList.add('error');
        logDetails(`[${basename(project.path)}] commit failed`, actionStatus.textContent);
      }
      await load();
    } finally {
      mutationBusy = false;
      syncActions();
    }
  }

  function workingFileGroups() {
    return [
      { label: 'Staged files', kind: 'staged', files: overview.changes.filter((file) => file.staged) },
      { label: 'Unstaged files', kind: 'unstaged', files: overview.changes.filter((file) => file.unstaged || file.untracked) },
    ];
  }

  function renderWorkingFiles(groups, preferredFile, options) {
    const scrollTop = files.scrollTop;
    const scrollLeft = files.scrollLeft;
    reconcileChildren(files, [stagedPane, stagingDivider.element, unstagedPane]);
    const liveKeys = new Set();
    let firstFile = null;
    let preferred = null;
    let samePath = null;
    for (const group of groups) {
      let view = workingGroups.get(group.kind);
      if (!view) {
        const pane = group.kind === 'staged' ? stagedPane : unstagedPane;
        view = {
          heading: element('div', 'history-preview-file-group'),
          list: element('div', 'history-worktree-file-list'),
          empty: element('div', 'history-worktree-empty'),
        };
        pane.append(view.heading, view.list);
        workingGroups.set(group.kind, view);
      }
      const listTop = view.list.scrollTop;
      const listLeft = view.list.scrollLeft;
      const staged = group.kind === 'staged';
      const toggle = stagingCheckbox(staged && group.files.length > 0, `${staged ? 'Unstage' : 'Stage'} all ${group.files.length} files`, group.files, !staged);
      toggle.appendChild(element('span', '', group.label));
      view.heading.replaceChildren(toggle, element('span', 'history-file-count', String(group.files.length)));
      const query = fileSearch.value.toLowerCase().trim();
      const rows = [];
      for (const item of group.files) {
        const key = `${group.kind}:${item.path}`;
        liveKeys.add(key);
        if (!item.path.toLowerCase().includes(query)) continue;
        const file = { ...item, kind: item.untracked ? 'untracked' : group.kind };
        const signature = JSON.stringify([file.status, file.originalPath, file.kind]);
        let entry = workingRows.get(key);
        if (!entry || entry.signature !== signature) {
          const button = element('button', 'history-preview-file');
          button.type = 'button';
          button.title = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
          const statusCode = staged ? file.status[0] : file.status[1];
          const status = element('span', 'history-preview-file-status', statusCode.trim() || 'M');
          status.dataset.status = statusCode.trim();
          button.append(status, element('span', 'history-preview-file-path', file.path));
          file.button = button;
          button.addEventListener('click', () => selectFile(file));
          const row = element('div', 'history-worktree-file-row');
          row.append(stagingCheckbox(staged, `${staged ? 'Unstage' : 'Stage'} ${file.path}`, [file], !staged), button);
          entry = { file, row, signature };
          workingRows.set(key, entry);
        }
        entry.row.querySelector('input').checked = staged;
        rows.push(entry.row);
        if (!firstFile) firstFile = entry.file;
        if (preferredFile?.path === file.path) {
          if (!samePath) samePath = entry.file;
          if (preferredFile.kind === file.kind) preferred = entry.file;
        }
      }
      if (!rows.length) {
        view.empty.textContent = group.files.length ? 'No files match your search.' : `No ${group.kind} files`;
        rows.push(view.empty);
      }
      reconcileChildren(view.list, rows);
      view.list.scrollTop = listTop;
      view.list.scrollLeft = listLeft;
    }
    for (const key of workingRows.keys()) if (!liveKeys.has(key)) workingRows.delete(key);
    files.scrollTop = scrollTop;
    files.scrollLeft = scrollLeft;
    const selected = preferred || samePath || firstFile;
    let preview;
    if (selected) {
      preview = selectFile(selected, '', options);
    } else {
      selectedFile = null;
      patchVersion += 1;
      diff.setAttribute('aria-busy', 'false');
      diffTitle.textContent = 'File preview';
      showDiff(fileSearch.value.trim() ? 'Select a matching file to preview.' : 'Working tree clean.');
    }
    syncActions();
    return preview;
  }

  function renderFiles(groups, commit = '', preferredFile = null, options = {}) {
    if (working) return renderWorkingFiles(groups, preferredFile, options);
    files.replaceChildren();
    let firstFile = null;
    let preferred = null;
    for (const group of groups) {
      files.appendChild(element('div', 'history-preview-file-group', `${group.label} · ${group.files.length}`));
      for (const item of group.files) {
        const file = { ...item, kind: group.kind };
        const button = element('button', 'history-preview-file');
        button.type = 'button';
        button.title = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
        const status = element('span', 'history-preview-file-status', file.status.trim() || 'M');
        status.dataset.status = file.status.trim();
        button.append(status, element('span', 'history-preview-file-path', file.path));
        file.button = button;
        button.addEventListener('click', () => selectFile(file, commit));
        files.appendChild(button);
        if (!firstFile) firstFile = file;
        if (preferredFile?.path === file.path && preferredFile.kind === file.kind) preferred = file;
      }
    }
    const selected = preferred || firstFile;
    let preview;
    if (selected) {
      preview = selectFile(selected, commit);
    } else {
      selectedFile = null;
      patchVersion += 1;
      diff.setAttribute('aria-busy', 'false');
      diffTitle.textContent = 'File preview';
      showDiff('This commit has no file changes.');
    }
    syncActions();
    return preview;
  }

  async function selectEntry(button, commit = null, preferredFile = null) {
    const request = ++detailVersion;
    patchVersion += 1;
    working = !commit;
    selectedCommit = commit;
    body.classList.toggle('is-working', working);
    metadata.hidden = working;
    worktreeToolbar.hidden = !working;
    commitForm.hidden = !working;
    timeline.querySelectorAll('button').forEach((row) => {
      row.classList.toggle('active', row === button);
      row.setAttribute('aria-pressed', String(row === button));
    });
    metadata.replaceChildren();
    files.replaceChildren();
    if (!commit) {
      pendingLabel.textContent = `Pending files · ${overview.changes.length}`;
      return renderFiles(workingFileGroups(), '', preferredFile);
    }
    metadata.append(element('h3', '', commit.subject));
    showDiff('Loading commit…');
    const result = await readPreview(() => window.api.gitHistoryCommit(project.path, commit.sha));
    if (closed || request !== detailVersion) return;
    if (!result?.ok) {
      showDiff(result?.error || 'Could not load this commit.');
      return;
    }
    const item = result.commit;
    metadata.append(element('p', '', `${item.authorName} <${item.authorEmail}> · ${dateText(item.authorDate)}`));
    metadata.append(element('code', 'history-preview-sha', item.sha));
    const message = item.message.split('\n').slice(1).join('\n').trim();
    if (message) metadata.append(element('p', 'history-preview-message', message));
    if (item.parents.length > 1) metadata.append(element('p', '', 'Merge changes compared with the first parent'));
    return renderFiles([{ label: 'Changed files', files: result.files }], commit.sha, preferredFile);
  }

  function renderTimeline(result) {
    const scrollTop = timeline.scrollTop;
    const scrollLeft = timeline.scrollLeft;
    graphObserver?.disconnect();
    timeline.replaceChildren();
    const graphCommits = [
      { sha: 'working-tree', parents: result.commits.length ? [result.commits[0].sha] : [], workingTree: true },
      ...result.commits,
    ];
    const graphLayout = layoutCommitGraph(graphCommits);
    const commitList = element('div', 'history-preview-commits');
    commitList.style.setProperty('--history-graph-width', `${graphLayout.laneCount * GRAPH_LANE_WIDTH + GRAPH_PADDING}px`);
    const graphButtons = [];
    timeline.appendChild(commitList);
    const workingTree = element('button', 'history-preview-entry history-preview-working');
    workingTreeEntry = workingTree;
    workingTree.type = 'button';
    workingTree.append(element('strong', '', 'Uncommitted changes'), element('span', '', `${result.changes.length} files`));
    workingTree.addEventListener('click', () => selectEntry(workingTree));
    commitList.appendChild(workingTree);
    graphButtons.push(workingTree);
    let firstCommit = null;
    for (const commit of result.commits) {
      const row = element('button', 'history-preview-entry');
      row.type = 'button';
      row.dataset.commit = commit.sha;
      row.title = `${commit.subject}\n${commit.sha}`;
      row.append(
        element('strong', '', commit.subject),
        element('span', '', `${commit.shortSha} · ${commit.authorName}`),
        element('time', '', dateText(commit.authorDate)),
      );
      if (commit.labels.length) {
        const labels = element('div', 'history-preview-refs');
        labels.title = commit.labels.join(', ');
        for (const label of commit.labels.slice(0, 3)) {
          labels.appendChild(element('span', 'history-preview-ref', label.replace(/^HEAD -> /, '')));
        }
        row.appendChild(labels);
      }
      row.addEventListener('click', () => selectEntry(row, commit));
      const active = !working && selectedCommit?.sha === commit.sha;
      row.classList.toggle('active', active);
      row.setAttribute('aria-pressed', String(active));
      commitList.appendChild(row);
      graphButtons.push(row);
      if (!firstCommit) firstCommit = { row, commit };
    }
    const redrawGraph = () => {
      if (!closed && commitList.isConnected) drawCommitGraph(commitList, graphCommits, graphButtons, graphLayout);
    };
    graphObserver = new ResizeObserver(redrawGraph);
    graphObserver.observe(commitList);
    redrawGraph();
    if (graphLayout.continues) timeline.appendChild(element('div', 'history-preview-state', 'Earlier commits continue beyond this preview.'));
    if (!firstCommit) timeline.appendChild(element('div', 'history-preview-state', 'No commits yet.'));
    firstCommitEntry = firstCommit;
    workingTree.classList.toggle('active', working);
    workingTree.setAttribute('aria-pressed', String(working));
    timeline.scrollTop = scrollTop;
    timeline.scrollLeft = scrollLeft;
  }

  async function load({ preferredFile = selectedFile, forceHistory = false } = {}) {
    const request = ++loadVersion;
    const initial = !overview;
    loading = true;
    syncActions();
    if (initial) {
      branch.textContent = 'Loading…';
      timeline.replaceChildren(element('div', 'history-preview-state', 'Loading history…'));
      showDiff('Loading…');
    }
    const result = await readPreview(() => window.api.gitHistoryPreview(
      project.path, forceHistory ? null : overview?.commitSnapshot
    ));
    if (closed || request !== loadVersion) return;
    loading = initial;
    if (!result?.ok) {
      loading = false;
      // Keep the last view visible, but invalidate its commit guard until a successful refresh.
      if (overview) overview = { ...overview, commitSnapshot: null };
      branch.textContent = 'Unavailable';
      actionStatus.textContent = result?.error || 'Could not load Git history.';
      actionStatus.classList.add('error');
      refreshFailed = true;
      if (initial) showDiff(actionStatus.textContent);
      syncActions();
      return;
    }
    const historyChanged = initial || (result.commits && JSON.stringify(result.commits) !== JSON.stringify(overview.commits));
    overview = { ...overview, ...result };
    branch.textContent = overview.branch || 'Detached HEAD';
    if (refreshFailed) {
      actionStatus.textContent = '';
      actionStatus.classList.remove('error');
      refreshFailed = false;
    }
    if (historyChanged) renderTimeline(overview);
    workingTreeEntry.querySelector('span').textContent = `${overview.changes.length} files`;
    footer.textContent = `${overview.commits.length} of ${overview.totalCount} commits · ${overview.branch || 'Detached HEAD'} · Local repository`;
    if (initial) {
      const saved = restoration;
      const savedCommit = overview.commits.find((commit) => commit.sha === saved?.selection);
      const savedRow = savedCommit ? timeline.querySelector(`[data-commit="${savedCommit.sha}"]`) : null;
      const file = saved?.selectedFile || preferredFile;
      let selection;
      if (savedCommit && savedRow) selection = selectEntry(savedRow, savedCommit, file);
      else if (saved?.selection === 'working-tree' || overview.changes.length || !firstCommitEntry) selection = selectEntry(workingTreeEntry, null, file);
      else selection = selectEntry(firstCommitEntry.row, firstCommitEntry.commit, file);
      const selectionVersion = detailVersion;
      await selection;
      if (closed || request !== loadVersion) return;
      if (saved && detailVersion === selectionVersion) restoreViewport(saved);
      restoration = null;
      loading = false;
    } else if (working) {
      pendingLabel.textContent = `Pending files · ${overview.changes.length}`;
      renderFiles(workingFileGroups(), '', preferredFile, { preservePreview: true });
    } else if (!overview.commits.some((commit) => commit.sha === selectedCommit?.sha)) {
      if (firstCommitEntry) void selectEntry(firstCommitEntry.row, firstCommitEntry.commit);
      else void selectEntry(workingTreeEntry);
    }
    syncActions();
  }

  const onWindowFocus = () => {
    if (!closed && !card.hidden && !mutationBusy && !loading) void load();
  };
  window.addEventListener('focus', onWindowFocus);
  closeButton.addEventListener('click', requestClose);
  refresh.addEventListener('click', () => load({ forceHistory: true }));
  fileSearch.addEventListener('input', () => {
    if (working && overview && !loading) renderFiles(workingFileGroups(), '', selectedFile, { preservePreview: true });
  });
  commitMessage.addEventListener('input', syncActions);
  commitMessage.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void commitStaged();
    }
  });
  commitForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void commitStaged();
  });
  if (!container && !navigation) overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKeydown);
  requestAnimationFrame(() => {
    if (closed || card.hidden) return;
    overlay.classList.add('open');
    if (autofocus) closeButton.focus();
  });
  void load();
  return {
    element: card,
    overlay,
    close,
    getState,
    isBusy: () => mutationBusy,
    setActive(active) {
      if (closed || (!active && mutationBusy)) return false;
      const wasHidden = card.hidden;
      card.hidden = !active;
      diffView.setActive(active);
      if (active) {
        if (navigation) header.after(navigation);
        syncActions();
        if (wasHidden && !loading) void load();
      }
      return true;
    },
  };
}
