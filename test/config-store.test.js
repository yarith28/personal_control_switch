const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createConfigStore } = require('../src/main/config-store');

async function withTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-sync-config-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('burst mode defaults on while preserving an explicit opt-out', async (t) => {
  const dir = await withTempDir(t);
  const configPath = path.join(dir, 'config.json');
  const store = createConfigStore({ getConfigPath: () => configPath });

  assert.equal((await store.load()).burst, true);

  await fs.writeFile(configPath, JSON.stringify({ projects: [], burst: false }), 'utf8');
  assert.equal((await store.load()).burst, false);
});

test('configuration updates are atomic and retain the previous valid version', async (t) => {
  const dir = await withTempDir(t);
  const configPath = path.join(dir, 'config.json');
  let clock = 1;
  const store = createConfigStore({ getConfigPath: () => configPath, now: () => clock++ });

  await store.update((config) => { config.items = [{ type: 'project', path: '/one' }]; });
  await store.update((config) => { config.items = [{ type: 'project', path: '/two' }]; });

  const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const backup = JSON.parse(await fs.readFile(store.paths().backupPath, 'utf8'));
  assert.equal(current.items[0].path, '/two');
  assert.equal(backup.items[0].path, '/one');
  assert.deepEqual((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
});

test('an unreadable configuration is preserved and restored from backup', async (t) => {
  const dir = await withTempDir(t);
  const configPath = path.join(dir, 'config.json');
  let clock = 1;
  const store = createConfigStore({ getConfigPath: () => configPath, now: () => clock++ });

  await store.update((config) => { config.items = [{ type: 'project', path: '/backup' }]; });
  await store.update((config) => { config.items = [{ type: 'project', path: '/current' }]; });
  await fs.writeFile(configPath, '{not-json', 'utf8');

  const recovered = await store.load({ reportRecovery: true });
  assert.equal(recovered.items[0].path, '/backup');
  assert.equal(recovered.configRecovery.title, 'Configuration restored');
  assert.match(recovered.configRecovery.message, /damaged file was preserved/i);

  const files = await fs.readdir(dir);
  assert.ok(files.some((name) => name.startsWith('config.corrupt-')));
  const repaired = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(repaired.items[0].path, '/backup');
});

test('a failed update does not poison later configuration saves', async (t) => {
  const dir = await withTempDir(t);
  const configPath = path.join(dir, 'config.json');
  let failNextWrite = true;
  const fsApi = {
    ...fs,
    async writeFile(...args) {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('simulated disk failure');
      }
      return fs.writeFile(...args);
    },
  };
  const store = createConfigStore({ getConfigPath: () => configPath, fsApi });

  await assert.rejects(
    store.update((config) => { config.theme = 'midnight'; }),
    /simulated disk failure/
  );
  await store.update((config) => { config.theme = 'forest'; });

  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(saved.theme, 'forest');
});
