const test = require('node:test');
const assert = require('node:assert/strict');

test('project search covers paths, branches, and folders', async () => {
  const { searchProjectTree } = await import('../src/renderer/js/project-search.mjs');
  const clean = {
    type: 'project', path: '/work/clean-repo', current: 'main', branches: ['main'],
  };
  const api = {
    type: 'project', path: '/work/api-service', current: 'feature/auth', branches: ['main'],
  };
  const missing = { type: 'project', path: '/work/missing', branches: null };
  const items = [
    clean,
    { type: 'folder', id: 'f1', name: 'Backend', items: [api, missing] },
  ];

  assert.equal(searchProjectTree(items, 'auth')[0].children[0], api);
  assert.equal(searchProjectTree(items, 'backend')[0].children.length, 2);
  assert.equal(searchProjectTree(items, 'clean')[0].item, clean);
  assert.equal(searchProjectTree(items, 'does-not-exist').length, 0);
});
