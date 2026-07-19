import { getProjects, state } from './state.js';
import { basename, displayPath } from './util.js';
import { showToast } from './notify.js';
import { log, logDetails } from './log.js';
import { confirmDialog } from './modal.js';

let root = null;
let preferredProjectPath = '';
let projectList = null;
let projectCount = null;
let projectFilterControl = null;
let projectEditorName = null;
let projectEditorPath = null;
let globalNameInput = null;
let globalEmailInput = null;
let globalSaveButton = null;
let globalStatus = null;
let globalValidation = null;
let projectNameInput = null;
let projectEmailInput = null;
let projectSaveButton = null;
let projectClearButton = null;
let projectStatus = null;
let projectValidation = null;
let loadedGlobal = null;
let loadedProject = null;
let globalBusy = false;
let globalLoading = false;
let projectBusy = false;
let projectLoading = false;
let globalRequest = 0;
let projectRequest = 0;
let projectMarkerRequest = 0;
let projectMarkers = new Map();
let projectMarkersLoading = false;
let projectFilter = 'all';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
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

function availableProjects() {
  return getProjects().filter((project) => project.path && !project.missing);
}

function syncProjectEditorContext() {
  const project = availableProjects().find((item) => item.path === preferredProjectPath);
  projectEditorName.textContent = project ? basename(project.path) : 'No project selected';
  projectEditorPath.textContent = project
    ? displayPath(project.path, state.homedir)
    : 'Add a project in Git Sync to configure its identity.';
}

function markerForIdentity(result) {
  if (!result?.ok) return '';
  if (result.hasNameOverride && result.hasEmailOverride) return 'set';
  if (result.hasNameOverride || result.hasEmailOverride) return 'partial';
  return 'unset';
}

function updateProjectMarker(repoPath, result) {
  const marker = markerForIdentity(result);
  if (marker) projectMarkers.set(repoPath, marker);
  else projectMarkers.delete(repoPath);
  renderProjectList();
}

async function refreshProjectMarkers() {
  const projects = availableProjects();
  const request = ++projectMarkerRequest;
  const markers = new Map();
  let nextIndex = 0;
  projectMarkersLoading = true;
  renderProjectList();

  async function worker() {
    while (nextIndex < projects.length) {
      const project = projects[nextIndex++];
      let result;
      try {
        result = await window.api.identityGet('project', project.path);
      } catch {
        result = null;
      }
      if (request !== projectMarkerRequest) return;
      const marker = markerForIdentity(result);
      if (marker) markers.set(project.path, marker);
    }
  }

  const workerCount = Math.min(4, projects.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (request !== projectMarkerRequest) return;
  projectMarkersLoading = false;
  projectMarkers = markers;
  renderProjectList();
  syncProjectControls();
}

function setProjectFilter(filter) {
  if (!['all', 'set', 'unset'].includes(filter) || filter === projectFilter) return;
  projectFilter = filter;
  projectFilterControl.querySelectorAll('.identity-project-filter-button').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderProjectList();
  syncProjectControls();
}

function renderProjectList() {
  const allProjects = availableProjects();
  const projects = allProjects.filter((project) => {
    if (projectFilter === 'all') return true;
    const marker = projectMarkers.get(project.path);
    if (projectFilter === 'set') return marker === 'set';
    return marker === 'unset' || marker === 'partial';
  });
  projectCount.textContent = String(projects.length);
  projectCount.title = projectFilter === 'all'
    ? `${allProjects.length} projects`
    : `${projects.length} of ${allProjects.length} projects`;
  if (!allProjects.length) {
    projectList.replaceChildren(el('div', {
      class: 'identity-project-list-state',
      text: 'No projects available.',
    }));
    return;
  }
  if (!projects.length) {
    const emptyText = projectMarkersLoading
      ? 'Checking project identities…'
      : projectFilter === 'set'
        ? 'No projects have a set identity.'
        : 'No unset projects.';
    projectList.replaceChildren(el('div', {
      class: 'identity-project-list-state',
      text: emptyText,
    }));
    return;
  }

  projectList.replaceChildren(...projects.map((project) => {
    const selected = project.path === preferredProjectPath;
    const marker = projectMarkers.get(project.path);
    return el('button', {
      class: `identity-project-item${selected ? ' active' : ''}`,
      type: 'button',
      title: project.path,
      'aria-pressed': String(selected),
      disabled: projectBusy || projectLoading,
      onclick: () => selectProject(project.path),
    }, [
      el('span', { class: 'identity-project-item-heading' }, [
        el('span', { class: 'identity-project-item-name', text: basename(project.path) }),
        marker ? el('span', {
          class: `identity-project-item-marker${marker === 'partial' ? ' partial' : ''}`,
          text: marker === 'partial' ? 'Partial' : 'Set',
          title: marker === 'partial'
            ? 'Project identity is partially set'
            : 'Project identity is set',
        }) : null,
      ]),
      el('span', {
        class: 'identity-project-item-path',
        text: displayPath(project.path, state.homedir),
      }),
    ]);
  }));
}

function populateProjects() {
  const projects = availableProjects();
  const paths = new Set(projects.map((project) => project.path));
  projectMarkers = new Map(
    Array.from(projectMarkers).filter(([repoPath]) => paths.has(repoPath))
  );
  if (!projects.some((project) => project.path === preferredProjectPath)) {
    preferredProjectPath = projects[0]?.path || '';
  }
  renderProjectList();
  syncProjectEditorContext();
}

function conventionalEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function identityText(name, email) {
  if (!name && !email) return 'No identity configured';
  if (!name) return email;
  if (!email) return name;
  return `${name} <${email}>`;
}

function setStatus(target, text, tone = '') {
  target.textContent = text;
  target.className = `identity-status${tone ? ` ${tone}` : ''}`;
}

function globalChanged() {
  return Boolean(
    loadedGlobal
    && (
      globalNameInput.value.trim() !== loadedGlobal.name
      || globalEmailInput.value.trim() !== loadedGlobal.email
    )
  );
}

function projectChanged() {
  return Boolean(
    loadedProject
    && (
      projectNameInput.value.trim() !== loadedProject.formName
      || projectEmailInput.value.trim() !== loadedProject.formEmail
    )
  );
}

function projectHasCompleteOverride() {
  return Boolean(loadedProject?.hasNameOverride && loadedProject?.hasEmailOverride);
}

function syncGlobalControls() {
  const name = globalNameInput.value.trim();
  const email = globalEmailInput.value.trim();
  globalNameInput.disabled = globalBusy || globalLoading;
  globalEmailInput.disabled = globalBusy || globalLoading;
  globalSaveButton.disabled = globalBusy || globalLoading || !name || !email || !globalChanged();
  globalSaveButton.textContent = globalBusy ? 'Saving…' : 'Update';
  globalValidation.textContent = email && !conventionalEmail(email)
    ? 'This email format is unusual, but Git will accept it.'
    : '';
  globalValidation.toggleAttribute('hidden', !globalValidation.textContent);
}

function syncProjectControls() {
  const hasProject = Boolean(preferredProjectPath);
  const name = projectNameInput.value.trim();
  const email = projectEmailInput.value.trim();
  projectList.querySelectorAll('.identity-project-item').forEach((item) => {
    item.disabled = projectBusy || projectLoading;
  });
  projectNameInput.disabled = projectBusy || projectLoading || !hasProject;
  projectEmailInput.disabled = projectNameInput.disabled;
  const needsOverride = loadedProject && !projectHasCompleteOverride();
  projectSaveButton.disabled = Boolean(
    projectBusy
    || projectLoading
    || !loadedProject
    || !name
    || !email
    || (!projectChanged() && !needsOverride)
  );
  projectSaveButton.textContent = projectBusy ? 'Saving…' : 'Set project identity';
  const hasOverride = Boolean(
    loadedProject?.hasNameOverride || loadedProject?.hasEmailOverride
  );
  projectClearButton.disabled = projectBusy || projectLoading || !hasOverride;
  projectValidation.textContent = email && !conventionalEmail(email)
    ? 'This email format is unusual, but Git will accept it.'
    : '';
  projectValidation.toggleAttribute('hidden', !projectValidation.textContent);
}

async function savePreference() {
  try {
    await window.api.saveConfig({ identityTool: { projectPath: preferredProjectPath } });
  } catch (error) {
    log(`[identity-tool] could not remember project selection: ${error.message || error}`, true);
  }
}

async function loadGlobal({ preserveEdits = false } = {}) {
  if (preserveEdits && globalChanged()) return;
  const request = ++globalRequest;
  globalLoading = true;
  loadedGlobal = null;
  globalNameInput.value = '';
  globalEmailInput.value = '';
  setStatus(globalStatus, 'Loading global Git identity…');
  syncGlobalControls();

  let result;
  try {
    result = await window.api.identityGet('global');
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  if (request !== globalRequest) return;
  globalLoading = false;

  if (!result.ok) {
    setStatus(globalStatus, result.error || 'Could not read global Git identity.', 'error');
    if (result.raw) logDetails('[identity-tool] global identity read failed', result.raw);
    syncGlobalControls();
    return;
  }

  loadedGlobal = { name: result.name || '', email: result.email || '' };
  globalNameInput.value = loadedGlobal.name;
  globalEmailInput.value = loadedGlobal.email;
  const value = identityText(loadedGlobal.name, loadedGlobal.email);
  setStatus(
    globalStatus,
    loadedGlobal.name || loadedGlobal.email
      ? `${value} · Used when a project has no local override.`
      : 'No global Git identity is configured.',
    loadedGlobal.name && loadedGlobal.email ? '' : 'warning'
  );
  syncGlobalControls();
}

async function loadProject({ preserveEdits = false } = {}) {
  if (preserveEdits && projectChanged()) return;
  const repoPath = preferredProjectPath;
  if (!repoPath) {
    projectRequest += 1;
    projectLoading = false;
    loadedProject = null;
    projectNameInput.value = '';
    projectEmailInput.value = '';
    setStatus(projectStatus, 'Add a project in Git Sync before setting a project identity.', 'warning');
    syncProjectControls();
    return;
  }

  const request = ++projectRequest;
  projectLoading = true;
  loadedProject = null;
  projectNameInput.value = '';
  projectEmailInput.value = '';
  setStatus(projectStatus, 'Loading project Git identity…');
  syncProjectControls();

  let result;
  try {
    result = await window.api.identityGet('project', repoPath);
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  if (request !== projectRequest) return;
  projectLoading = false;

  if (!result.ok) {
    setStatus(projectStatus, result.error || 'Could not read project Git identity.', 'error');
    if (result.raw) logDetails('[identity-tool] project identity read failed', result.raw);
    syncProjectControls();
    return;
  }

  const formName = result.name || result.effectiveName || '';
  const formEmail = result.email || result.effectiveEmail || '';
  loadedProject = { ...result, repoPath, formName, formEmail };
  updateProjectMarker(repoPath, result);
  projectNameInput.value = formName;
  projectEmailInput.value = formEmail;
  const effective = identityText(result.effectiveName, result.effectiveEmail);
  if (result.hasNameOverride && result.hasEmailOverride) {
    setStatus(projectStatus, `${effective} · Project override is active.`);
  } else if (result.hasNameOverride || result.hasEmailOverride) {
    setStatus(projectStatus, `${effective} · This project has a partial local override.`, 'warning');
  } else if (result.effectiveName || result.effectiveEmail) {
    setStatus(projectStatus, `${effective} · Currently inherited from global or system Git configuration.`);
  } else {
    setStatus(projectStatus, 'No project override or inherited Git identity is configured.', 'warning');
  }
  syncProjectControls();
}

async function saveGlobalIdentity() {
  if (globalSaveButton.disabled || globalBusy) return;
  const name = globalNameInput.value.trim();
  const email = globalEmailInput.value.trim();
  globalBusy = true;
  syncGlobalControls();

  let result;
  try {
    result = await window.api.identitySave({ scope: 'global', name, email });
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  globalBusy = false;

  if (!result.ok) {
    setStatus(globalStatus, result.error || 'Global Git identity was not saved.', 'error');
    showToast('Global identity was not saved', result.error || '', { tone: 'error' });
    if (result.raw) logDetails('[identity-tool] global identity update failed', result.raw);
    syncGlobalControls();
    return;
  }

  log(`[identity-tool] updated global identity to ${name} <${email}>`, true);
  showToast('Global identity updated', `${name} <${email}>`);
  await loadGlobal();
  if (loadedProject && !projectHasCompleteOverride()) {
    await loadProject({ preserveEdits: true });
  }
}

async function saveProjectIdentity() {
  if (projectSaveButton.disabled || projectBusy) return;
  const repoPath = preferredProjectPath;
  const name = projectNameInput.value.trim();
  const email = projectEmailInput.value.trim();
  projectMarkerRequest += 1;
  projectMarkersLoading = false;
  projectBusy = true;
  syncProjectControls();

  let result;
  try {
    result = await window.api.identitySave({ scope: 'project', repoPath, name, email });
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  projectBusy = false;

  if (!result.ok) {
    setStatus(projectStatus, result.error || 'Project Git identity was not saved.', 'error');
    showToast('Project identity was not saved', result.error || '', { tone: 'error' });
    if (result.raw) logDetails('[identity-tool] project identity update failed', result.raw);
    syncProjectControls();
    return;
  }

  log(`[identity-tool] updated ${basename(repoPath)} identity to ${name} <${email}>`, true);
  showToast('Project identity updated', `${name} <${email}>`);
  await loadProject();
}

async function clearProjectOverride() {
  if (projectClearButton.disabled || projectBusy) return;
  const repoPath = preferredProjectPath;
  const confirmed = await confirmDialog({
    message: `Remove the identity override for "${basename(repoPath)}"?`,
    detail: 'Future commits in this project will inherit the global or system Git identity.',
    confirmText: 'Remove override',
    danger: false,
  });
  if (!confirmed) return;

  projectMarkerRequest += 1;
  projectMarkersLoading = false;
  projectBusy = true;
  syncProjectControls();
  let result;
  try {
    result = await window.api.identityClearProject(repoPath);
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  projectBusy = false;

  if (!result.ok) {
    setStatus(projectStatus, result.error || 'Project identity override was not removed.', 'error');
    showToast('Override was not removed', result.error || '', { tone: 'error' });
    if (result.raw) logDetails('[identity-tool] identity override removal failed', result.raw);
    syncProjectControls();
    return;
  }

  log(`[identity-tool] removed project identity override from ${basename(repoPath)}`, true);
  showToast('Project override removed', 'This project now inherits its Git identity.');
  await loadProject();
}

async function selectProject(nextProjectPath) {
  if (!nextProjectPath || nextProjectPath === preferredProjectPath) return;
  if (projectChanged()) {
    const discard = await confirmDialog({
      message: 'Discard unsaved project identity changes?',
      detail: 'The current project name and email edits have not been saved.',
      confirmText: 'Discard',
      danger: false,
    });
    if (!discard) return;
  }
  preferredProjectPath = nextProjectPath;
  renderProjectList();
  syncProjectEditorContext();
  await savePreference();
  await loadProject();
}

function identityField(label, input) {
  return el('label', { class: 'identity-field' }, [el('span', { text: label }), input]);
}

function buildShell() {
  globalNameInput = el('input', {
    class: 'identity-input', type: 'text', autocomplete: 'off',
    placeholder: 'Git user name', 'aria-label': 'Global Git user name', oninput: syncGlobalControls,
  });
  globalEmailInput = el('input', {
    class: 'identity-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Git email', 'aria-label': 'Global Git email', oninput: syncGlobalControls,
  });
  globalStatus = el('div', { class: 'identity-status', role: 'status', 'aria-live': 'polite' });
  globalValidation = el('div', { class: 'identity-validation', hidden: true });
  globalSaveButton = el('button', {
    class: 'btn btn-primary identity-save-button', type: 'submit',
  }, ['Update']);

  projectList = el('div', {
    class: 'identity-project-list',
    role: 'list',
    'aria-label': 'Projects',
  });
  projectCount = el('span', { class: 'identity-project-count', text: '0' });
  projectFilterControl = el('div', {
    class: 'identity-project-filters',
    role: 'group',
    'aria-label': 'Filter projects by identity status',
  }, ['all', 'set', 'unset'].map((filter) => el('button', {
    class: `identity-project-filter-button${filter === projectFilter ? ' active' : ''}`,
    type: 'button',
    'data-filter': filter,
    'aria-pressed': String(filter === projectFilter),
    onclick: () => setProjectFilter(filter),
  }, [filter[0].toUpperCase() + filter.slice(1)])));
  projectEditorName = el('div', { class: 'identity-project-editor-name' });
  projectEditorPath = el('div', { class: 'identity-project-editor-path' });
  projectNameInput = el('input', {
    class: 'identity-input', type: 'text', autocomplete: 'off',
    placeholder: 'Git user name', 'aria-label': 'Project Git user name', oninput: syncProjectControls,
  });
  projectEmailInput = el('input', {
    class: 'identity-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Git email', 'aria-label': 'Project Git email', oninput: syncProjectControls,
  });
  projectStatus = el('div', { class: 'identity-status', role: 'status', 'aria-live': 'polite' });
  projectValidation = el('div', { class: 'identity-validation', hidden: true });
  projectClearButton = el('button', {
    class: 'btn identity-clear-button', type: 'button', onclick: clearProjectOverride,
  }, ['Remove override']);
  projectSaveButton = el('button', {
    class: 'btn btn-primary identity-save-button', type: 'submit',
  }, ['Set project identity']);

  const globalForm = el('form', {
    class: 'identity-editor-row identity-global-row',
    onsubmit: (event) => { event.preventDefault(); saveGlobalIdentity(); },
  }, [
    el('div', { class: 'identity-row-context' }, [
      el('div', { class: 'identity-row-title', text: 'Global identity' }),
      el('div', { class: 'identity-row-copy', text: 'Default for projects without a local override.' }),
    ]),
    identityField('Name', globalNameInput),
    identityField('Email', globalEmailInput),
    el('div', { class: 'identity-row-actions' }, [globalSaveButton]),
    globalValidation,
    globalStatus,
  ]);

  const projectForm = el('form', {
    class: 'identity-project-editor',
    onsubmit: (event) => { event.preventDefault(); saveProjectIdentity(); },
  }, [
    el('div', { class: 'identity-project-editor-head' }, [
      el('div', { class: 'identity-project-editor-title', text: 'Project identity' }),
      projectEditorName,
      projectEditorPath,
    ]),
    el('div', { class: 'identity-project-fields' }, [
      identityField('Name', projectNameInput),
      identityField('Email', projectEmailInput),
    ]),
    projectValidation,
    projectStatus,
    el('div', { class: 'identity-project-actions' }, [projectClearButton, projectSaveButton]),
  ]);

  const projectWorkspace = el('section', { class: 'identity-project-workspace' }, [
    el('div', { class: 'identity-project-browser' }, [
      el('div', { class: 'identity-project-list-heading' }, [
        el('span', { text: 'Projects' }),
        projectCount,
      ]),
      projectFilterControl,
      projectList,
    ]),
    projectForm,
  ]);

  root.replaceChildren(
    el('section', { class: 'identity-card' }, [
      el('div', { class: 'identity-editors' }, [globalForm, projectWorkspace]),
    ])
  );
}

export function setupIdentityTool(initialConfig = {}) {
  root = document.getElementById('identity-tool-workspace');
  if (!root) return;
  preferredProjectPath = initialConfig.projectPath || '';
  buildShell();
  populateProjects();
  syncGlobalControls();
  syncProjectControls();
  loadGlobal();
  loadProject();
  refreshProjectMarkers();

  window.addEventListener('pcs:tab-change', (event) => {
    if (event.detail?.name !== 'identity-tool') return;
    const previousProject = preferredProjectPath;
    populateProjects();
    loadGlobal({ preserveEdits: true });
    loadProject({ preserveEdits: previousProject === preferredProjectPath });
    refreshProjectMarkers();
  });
}
