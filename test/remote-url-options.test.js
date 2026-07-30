const test = require('node:test');
const assert = require('node:assert/strict');

test('remote profiles migrate labels, deduplicate URLs, and import configured Git URLs', async () => {
  const {
    applyGitRemoteUrlChange,
    mergeConfiguredRemoteUrls,
    normalizeRemoteUrlOptions,
    selectRemoteName,
    validateProfileName,
    validateRemoteUrl,
  } = await import('../src/renderer/js/remote-url-options.mjs');

  const normalized = normalizeRemoteUrlOptions([
    { id: 'one', remoteName: ' origin ', url: ' https://example.com/one.git ' },
    { id: 'duplicate', profileName: 'origin', url: 'https://example.com/one.git' },
    { id: 'duplicate_elsewhere', profileName: 'upstream', url: 'https://example.com/one.git' },
    { id: 'history_only', url: '/tmp/repository.git' },
    { id: 'bad id', profileName: 'origin', url: 'https://example.com/two.git' },
  ]);
  assert.deepEqual(normalized, [
    { id: 'one', profileName: 'origin', url: 'https://example.com/one.git' },
    { id: 'history_only', url: '/tmp/repository.git' },
  ]);

  let nextId = 0;
  const merged = mergeConfiguredRemoteUrls(normalized, [
    {
      name: 'origin',
      url: 'https://example.com/two.git',
      urls: ['https://example.com/two.git', 'https://example.com/mirror.git'],
      pushUrl: 'ssh://push.example.com/repository.git',
      pushUrls: ['ssh://push.example.com/repository.git'],
    },
    { name: 'upstream', url: 'https://example.com/one.git' },
  ], () => `added_${++nextId}`);
  assert.equal(merged.changed, true);
  assert.deepEqual(merged.options, [
    ...normalized,
    { id: 'added_1', profileName: 'origin', url: 'https://example.com/two.git' },
    { id: 'added_2', profileName: 'origin', url: 'https://example.com/mirror.git' },
    { id: 'added_3', profileName: 'origin', url: 'ssh://push.example.com/repository.git' },
  ]);

  const remotes = [{ name: 'origin' }, { name: 'job23' }];
  assert.equal(selectRemoteName('job23', remotes, ['origin']), 'job23');
  assert.equal(selectRemoteName('missing', remotes, ['origin']), 'origin');
  assert.equal(selectRemoteName('', [{ name: 'job23' }]), 'job23');
  assert.deepEqual(validateProfileName(' Work account '), {
    ok: true,
    profileName: 'Work account',
  });
  assert.equal(validateProfileName('').ok, false);
  assert.equal(validateProfileName('work\u0000account').ok, false);
  assert.equal(validateProfileName('x'.repeat(65)).ok, false);
  assert.equal(validateRemoteUrl('/tmp/repository.git').ok, true);
  assert.equal(validateRemoteUrl('').ok, false);

  const changedRemote = {
    name: 'origin',
    url: 'https://example.com/work.git',
    urls: ['https://example.com/work.git'],
    pushUrl: 'ssh://push.example.com/work.git',
    pushUrls: ['ssh://push.example.com/work.git'],
    hasExplicitPushUrl: true,
  };
  const changedRemotes = applyGitRemoteUrlChange(
    [{ name: 'origin', url: 'https://example.com/old.git' }, { name: 'job23' }],
    { remote: changedRemote }
  );
  assert.deepEqual(changedRemotes, [{ name: 'job23' }, changedRemote]);
});
