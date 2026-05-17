import { getProjects } from './state.js';
import { renderProjects } from './render-list.js';
import { persist } from './persist.js';

export async function refreshBranches(project) {
  const res = await window.api.getBranches(project.path);
  if (res.ok) {
    project.branches = res.branches;
    project.current  = res.current;
    project.ahead    = res.ahead;
    project.behind   = res.behind;
    project.error    = null;
  } else {
    project.branches = null;
    project.current = null;
    project.error = res.error;
    project.selected = false;
  }
}

let _refreshing = false;
let _fetching = false;
let _lastRefresh = 0;
let _lastFetch = 0;
const REFRESH_DEBOUNCE_MS = 1500;
const FETCH_DEBOUNCE_MS = 30 * 1000; // network: don't hammer origin more than once per 30s

async function workerPool(items, concurrency, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]);
  };
  await Promise.all(Array(concurrency).fill(0).map(worker));
}

// Fetch from origin for every project, then refresh local state.
// `force: true` bypasses the fetch debounce (used by the manual refresh button).
export async function fetchAndRefreshAll({ force = false } = {}) {
  if (_fetching) return;
  if (!force && Date.now() - _lastFetch < FETCH_DEBOUNCE_MS) {
    // Too soon for another network round-trip — just refresh local state.
    return refreshAll({ force: true });
  }
  const projects = getProjects().filter((p) => !p.error);
  if (projects.length === 0) return;
  _fetching = true;
  try {
    await workerPool(projects, 4, async (p) => {
      try { await window.api.fetch(p.path); } catch { /* swallow — refresh shows the error */ }
    });
    _lastFetch = Date.now();
  } finally {
    _fetching = false;
  }
  await refreshAll({ force: true });
}

export async function refreshAll({ force = false } = {}) {
  if (_refreshing) return;
  if (getProjects().length === 0) return;
  if (!force && Date.now() - _lastRefresh < REFRESH_DEBOUNCE_MS) return;
  _refreshing = true;
  try {
    const projects = getProjects();
    await workerPool(projects, 4, refreshBranches);
    renderProjects();
    persist();
  } finally {
    _refreshing = false;
    _lastRefresh = Date.now();
  }
}
