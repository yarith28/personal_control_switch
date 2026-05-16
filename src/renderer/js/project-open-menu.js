import { basename, positionDropdown } from './util.js';
import { log } from './log.js';

function targetsForPlatform() {
  const isMac = document.body.classList.contains('platform-darwin');
  const isWindows = document.body.classList.contains('platform-win32');

  return [
    { id: 'terminal', label: 'Terminal' },
    { id: 'vscode', label: 'VS Code' },
    { id: 'sourcetree', label: 'SourceTree' },
    { id: 'antigravity', label: 'Antigravity' },
    { id: 'finder', label: isMac ? 'Finder' : (isWindows ? 'Explorer' : 'Folder') },
  ];
}

export function createProjectOpenMenu({ trigger, projectPath, scope = '', disabled } = {}) {
  if (!trigger || !projectPath) return null;

  trigger.classList.add('project-open-trigger');
  trigger.title = 'Open with...';

  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';
  if (scope) dropdown.dataset.menuScope = scope;
  document.body.appendChild(dropdown);

  trigger.addEventListener('click', (event) => {
    if (disabled?.()) return;
    event.stopPropagation();

    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.branch-dropdown.open, .move-dropdown.open').forEach((item) => item.classList.remove('open'));
    if (isOpen) return;

    dropdown.replaceChildren();
    for (const target of targetsForPlatform()) {
      const option = document.createElement('div');
      option.className = 'move-option';
      option.textContent = target.label;
      option.addEventListener('click', async (optionEvent) => {
        optionEvent.stopPropagation();
        dropdown.classList.remove('open');
        const result = await window.api.openWith(projectPath, target.id);
        if (!result.ok) {
          log(`[${basename(projectPath)}] failed to open in ${target.label}: ${result.error}`, true);
        }
      });
      dropdown.appendChild(option);
    }

    dropdown.classList.add('open');
    positionDropdown(dropdown, trigger.getBoundingClientRect());
  });

  return dropdown;
}
