import { projectsEl } from './dom.js';
import { addProjectPaths } from './actions.js';
import { log } from './log.js';
import { showToast } from './notify.js';

function containsFiles(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes('Files');
}

function droppedPaths(dataTransfer) {
  const getPathForFile = window.api?.getPathForFile;
  if (typeof getPathForFile !== 'function') {
    throw new Error('Drag-and-drop support is not loaded yet. Restart the app and try again.');
  }

  const paths = [];
  for (const file of Array.from(dataTransfer?.files || [])) {
    const path = getPathForFile(file);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function setupProjectDrop() {
  const clearDropState = () => projectsEl.classList.remove('file-drag-over');

  // Prevent Chromium from navigating away when a file is dropped outside the
  // project list. Drops are accepted only by the Git Sync project area below.
  document.addEventListener('dragover', (event) => {
    if (containsFiles(event.dataTransfer)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (containsFiles(event.dataTransfer)) event.preventDefault();
  });

  projectsEl.addEventListener('dragenter', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    projectsEl.classList.add('file-drag-over');
  }, true);

  projectsEl.addEventListener('dragover', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    projectsEl.classList.add('file-drag-over');
  }, true);

  projectsEl.addEventListener('dragleave', (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    if (!projectsEl.contains(event.relatedTarget)) clearDropState();
  }, true);

  projectsEl.addEventListener('drop', async (event) => {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropState();

    try {
      const paths = droppedPaths(event.dataTransfer);
      if (paths.length === 0) {
        throw new Error('The dropped folder path could not be read.');
      }
      await addProjectPaths(paths, { notify: true });
    } catch (error) {
      const message = error?.message || String(error);
      log(`[drop] could not add project: ${message}`);
      showToast('Could not add project', message, { tone: 'error' });
    }
  }, true);

  window.addEventListener('blur', clearDropState);
}
