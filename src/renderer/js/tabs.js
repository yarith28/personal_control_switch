// Header tab bar — switches between top-level pages (Git Sync, Cross Sync).
export function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-bar .tab'));
  const pages = Array.from(document.querySelectorAll('.page'));

  const placeSharedControls = (name) => {
    const controls = document.getElementById('shared-tab-controls');
    const output = document.getElementById('output-wrap');
    const page = document.querySelector(`.page[data-page="${name}"]`);
    const toolbar = name === 'cross-sync'
      ? page?.querySelector('.cross-head')
      : page?.querySelector('.toolbar');

    if (controls && toolbar) toolbar.appendChild(controls);
    if (output && page) page.appendChild(output);
  };

  const activate = (name) => {
    for (const tab of tabs) {
      tab.classList.toggle('active', tab.dataset.tab === name);
    }
    for (const page of pages) {
      page.toggleAttribute('hidden', page.dataset.page !== name);
    }
    placeSharedControls(name);
    window.dispatchEvent(new CustomEvent('pcs:tab-change', { detail: { name } }));
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
  }
}
