import { getProjects } from './state.js';
import { renderProjects } from './render-list.js';
import { persist } from './persist.js';
import { log } from './log.js';
import {
  mergeConfiguredRemoteUrls,
  normalizeRemoteUrlOptions,
  selectRemoteName,
} from './remote-url-options.mjs';
import { normalizeAppRemotes } from './app-remotes.mjs';

function makeRemoteId(options) {
  const existing = new Set(options.map((option) => option.id));
  let id;
  do {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
      || Math.random().toString(36).slice(2, 14);
    id = `remote_${Date.now().toString(36)}_${random}`;
  } while (existing.has(id));
  return id;
}

function reconcileRemoteHistory(project, result) {
  const gitRemotes = Array.isArray(result.gitRemotes) ? result.gitRemotes : [];
  let options = normalizeRemoteUrlOptions(project.remoteUrls);
  let changed = JSON.stringify(options) !== JSON.stringify(project.remoteUrls || []);
  const selectedRemoteName = selectRemoteName(
    project.selectedRemoteName,
    gitRemotes,
    [result.configuredRemote, result.defaultRemote]
  );

  if (selectedRemoteName) {
    for (const option of options) {
      if (option.remoteName) continue;
      option.remoteName = selectedRemoteName;
      changed = true;
    }
  }

  const legacyRemotes = normalizeAppRemotes(project.appRemotes);
  for (const legacy of legacyRemotes) {
    if (options.some((option) => option.url === legacy.url)) continue;
    options.push({
      id: makeRemoteId(options),
      ...(selectedRemoteName ? { remoteName: selectedRemoteName } : {}),
      url: legacy.url,
    });
    changed = true;
  }
  if (legacyRemotes.length || (project.appRemotes || []).length) {
    project.appRemotes = [];
    changed = true;
  }

  const merged = mergeConfiguredRemoteUrls(options, gitRemotes, makeRemoteId);
  project.remoteUrls = merged.options;
  project.gitRemotes = gitRemotes;
  project.gitRemoteNames = gitRemotes.map((remote) => remote.name);
  if (project.selectedRemoteName !== selectedRemoteName) changed = true;
  project.selectedRemoteName = selectedRemoteName;
  if ('selectedRemoteUrlId' in project) {
    delete project.selectedRemoteUrlId;
    changed = true;
  }
  return changed || merged.changed;
}

export async function refreshBranches(project) {
  let res;
  try {
    res = await window.api.getBranches(project.path);
  } catch (error) {
    const detail = error?.message || String(error);
    res = {
      ok: false,
      error: 'Could not refresh this project.',
      rawError: detail,
      errorCode: 'IPC_ERROR',
    };
  }
  if (res.ok) {
    reconcileRemoteHistory(project, res);
    project.branches    = res.branches;
    project.remoteBranches = res.remoteBranches || [];
    project.current     = res.current;
    project.hasUpstream = res.hasUpstream;
    project.upstream    = res.upstream || null;
    project.configuredRemote = res.configuredRemote || null;
    project.defaultRemote = res.defaultRemote || null;
    project.ahead       = res.ahead;
    project.behind      = res.behind;
    project.uncommitted = res.uncommitted ?? 0;
    project.error       = null;
    project.errorCode   = '';
    project.rawError    = '';
    project.missing     = false;
  } else {
    project.branches = null;
    project.remoteBranches = [];
    project.current = null;
    project.hasUpstream = null;
    project.upstream = null;
    project.gitRemotes = [];
    project.gitRemoteNames = [];
    project.configuredRemote = null;
    project.defaultRemote = null;
    project.uncommitted = 0;
    project.error = res.error;
    project.errorCode = res.errorCode || '';
    project.rawError = res.rawError || '';
    project.missing = !!res.missing;
    project.selected = false;
  }
}

let _refreshing = false;
let _lastRefresh = 0;
const REFRESH_DEBOUNCE_MS = 1500;

async function workerPool(items, concurrency, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array(concurrency).fill(0).map(worker));
}

// Re-read git state for every project (branches, current, ahead/behind, uncommitted)
// and repaint. Local only — does NOT contact remote. Auto-refresh callers should
// pass `source` for log visibility; internal callers (post pull/push/commit) leave it default.
export async function refreshAll({ force = false, source = '' } = {}) {
  if (_refreshing) {
    if (source) log(`auto-refresh (${source}): skipped, already refreshing`);
    return;
  }
  const projects = getProjects();
  if (projects.length === 0) {
    if (source) log(`auto-refresh (${source}): no projects`);
    return;
  }
  if (!force && Date.now() - _lastRefresh < REFRESH_DEBOUNCE_MS) return;
  _refreshing = true;
  try {
    if (source) log(`auto-refresh (${source}): re-reading ${projects.length} project(s)...`);
    await workerPool(projects, 4, refreshBranches);
    renderProjects();
    persist();
    if (source) {
      const failed = projects.filter((project) => project.error).length;
      log(
        failed
          ? `auto-refresh (${source}): completed with ${failed} project error${failed === 1 ? '' : 's'}`
          : `auto-refresh (${source}): done`,
        true
      );
    }
  } finally {
    _refreshing = false;
    _lastRefresh = Date.now();
  }
}
