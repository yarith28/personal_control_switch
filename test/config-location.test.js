const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createConfigLocationStore } = require('../src/main/config-location');

async function withTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-sync-location-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('configuration location persists separately and can return to default', async (t) => {
  const dir = await withTempDir(t);
  const defaultConfigPath = path.join(dir, 'config.json');
  const pointerPath = path.join(dir, 'config-location.json');
  const customConfigPath = path.join(dir, 'shared', 'git-sync.json');
  await fs.mkdir(path.dirname(customConfigPath));
  await fs.writeFile(customConfigPath, JSON.stringify({ items: [] }), 'utf8');

  const first = createConfigLocationStore({ defaultConfigPath, pointerPath, processId: 1 });
  assert.deepEqual(await first.initialize(), {
    path: defaultConfigPath,
    defaultPath: defaultConfigPath,
    isDefault: true,
    isEnvironmentOverride: false,
    environmentVariable: '',
  });
  const selected = await first.setPath(customConfigPath);
  assert.equal(selected.ok, true);
  assert.equal(selected.path, customConfigPath);

  const second = createConfigLocationStore({ defaultConfigPath, pointerPath, processId: 2 });
  assert.equal((await second.initialize()).path, customConfigPath);
  assert.equal((await second.reset()).isDefault, true);
  await assert.rejects(fs.access(pointerPath));
});

test('invalid configuration files do not replace the active location', async (t) => {
  const dir = await withTempDir(t);
  const defaultConfigPath = path.join(dir, 'config.json');
  const pointerPath = path.join(dir, 'config-location.json');
  const invalidPath = path.join(dir, 'invalid.json');
  await fs.writeFile(invalidPath, '[]', 'utf8');

  const store = createConfigLocationStore({ defaultConfigPath, pointerPath });
  await store.initialize();
  const result = await store.setPath(invalidPath);
  assert.equal(result.ok, false);
  assert.match(result.error, /valid app configuration/i);
  assert.equal((await store.initialize()).path, defaultConfigPath);
});

test('the legacy default config migrates once without overwriting the new default', async (t) => {
  const dir = await withTempDir(t);
  const defaultConfigPath = path.join(dir, 'git_sync_config.json');
  const legacyPath = path.join(dir, 'app-data', 'config.json');
  const pointerPath = path.join(dir, 'app-data', 'config-location.json');
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, JSON.stringify({ items: [{ path: '/legacy' }] }), 'utf8');

  const store = createConfigLocationStore({ defaultConfigPath, pointerPath });
  const migrated = await store.migrateDefaultFrom(legacyPath);
  assert.equal(migrated.migrated, true);
  assert.equal(JSON.parse(await fs.readFile(defaultConfigPath, 'utf8')).items[0].path, '/legacy');

  await fs.writeFile(legacyPath, JSON.stringify({ items: [{ path: '/changed' }] }), 'utf8');
  const second = await store.migrateDefaultFrom(legacyPath);
  assert.equal(second.migrated, false);
  assert.equal(JSON.parse(await fs.readFile(defaultConfigPath, 'utf8')).items[0].path, '/legacy');
});

test('an environment override wins without replacing the saved location', async (t) => {
  const dir = await withTempDir(t);
  const defaultConfigPath = path.join(dir, 'git_sync_config.json');
  const pointerPath = path.join(dir, 'config-location.json');
  const selectedPath = path.join(dir, 'selected.json');
  const environmentPath = path.join(dir, 'environment.json');
  await fs.writeFile(pointerPath, JSON.stringify({ configPath: selectedPath }), 'utf8');

  const store = createConfigLocationStore({
    defaultConfigPath,
    pointerPath,
    overrideConfigPath: environmentPath,
    overrideLabel: 'GIT_SYNC_CONFIG_PATH',
  });
  const location = await store.initialize();
  assert.equal(location.path, environmentPath);
  assert.equal(location.isEnvironmentOverride, true);
  assert.equal(location.environmentVariable, 'GIT_SYNC_CONFIG_PATH');
  assert.equal((await store.setPath(defaultConfigPath)).ok, false);
  assert.equal((await store.reset()).ok, false);
  assert.equal(JSON.parse(await fs.readFile(pointerPath, 'utf8')).configPath, selectedPath);
});
