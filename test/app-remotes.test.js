const test = require('node:test');
const assert = require('node:assert/strict');

test('app remotes normalize, select, and validate name-and-URL entries', async () => {
  const {
    normalizeAppRemotes,
    selectedAppRemote,
    validateAppRemoteDraft,
  } = await import('../src/renderer/js/app-remotes.mjs');

  const remotes = normalizeAppRemotes([
    { id: 'one', name: ' origin ', url: ' https://example.com/repo.git ' },
    { id: 'two', name: 'ORIGIN', url: '/duplicate' },
    { id: 'bad id', name: 'backup', url: '/backup' },
    { id: 'local', name: 'local', url: '/tmp/repository.git' },
  ]);
  assert.deepEqual(remotes, [
    { id: 'one', name: 'origin', url: 'https://example.com/repo.git' },
    { id: 'local', name: 'local', url: '/tmp/repository.git' },
  ]);
  assert.equal(selectedAppRemote({ appRemotes: remotes, selectedRemoteId: 'local' }).url, '/tmp/repository.git');
  assert.equal(selectedAppRemote({ appRemotes: remotes, selectedRemoteId: 'missing' }), null);
  assert.equal(validateAppRemoteDraft('work', 'git@example.com:team/repo.git').ok, true);
  assert.equal(validateAppRemoteDraft('', '/tmp/repository.git').ok, false);
  assert.equal(validateAppRemoteDraft('work', '').ok, false);
});
