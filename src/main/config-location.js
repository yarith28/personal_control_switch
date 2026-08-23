const fs = require('node:fs/promises');
const path = require('node:path');

function createConfigLocationStore({
  defaultConfigPath,
  pointerPath,
  overrideConfigPath = '',
  overrideLabel = '',
  fsApi = fs,
  processId = process.pid,
} = {}) {
  if (!path.isAbsolute(defaultConfigPath || '') || !path.isAbsolute(pointerPath || '')) {
    throw new TypeError('Config and pointer paths must be absolute');
  }

  const defaultPath = path.resolve(defaultConfigPath);
  const locationPath = path.resolve(pointerPath);
  const environmentPath = path.isAbsolute(overrideConfigPath || '')
    ? path.resolve(overrideConfigPath)
    : '';
  let activePath = environmentPath || defaultPath;
  let initialized = false;

  function info() {
    return {
      path: activePath,
      defaultPath,
      isDefault: !environmentPath && activePath === defaultPath,
      isEnvironmentOverride: !!environmentPath,
      environmentVariable: environmentPath ? overrideLabel : '',
    };
  }

  async function initialize() {
    if (initialized) return info();
    initialized = true;
    if (environmentPath) return info();
    try {
      const saved = JSON.parse(await fsApi.readFile(locationPath, 'utf8'));
      if (
        typeof saved?.configPath === 'string'
        && path.isAbsolute(saved.configPath)
        && path.resolve(saved.configPath) !== locationPath
      ) {
        activePath = path.resolve(saved.configPath);
      }
    } catch {
      activePath = defaultPath;
    }
    return info();
  }

  async function validateConfigFile(candidatePath) {
    let parsed;
    try {
      parsed = JSON.parse(await fsApi.readFile(candidatePath, 'utf8'));
    } catch (error) {
      let message = 'The selected configuration file could not be read.';
      if (error?.code === 'ENOENT') {
        message = 'The selected configuration file does not exist.';
      } else if (error?.code === 'EACCES' || error?.code === 'EPERM') {
        message = 'You do not have permission to read the selected configuration file.';
      } else if (error instanceof SyntaxError) {
        message = 'The selected configuration file contains invalid JSON.';
      } else if (error?.message) {
        message = `The selected configuration file could not be read: ${error.message}`;
      }
      return {
        ok: false,
        error: message,
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'The selected file is not a valid app configuration.' };
    }
    return { ok: true };
  }

  async function setPath(candidatePath) {
    await initialize();
    if (environmentPath) {
      return {
        ok: false,
        error: `${overrideLabel || 'The environment'} currently overrides the configuration location.`,
      };
    }
    if (typeof candidatePath !== 'string' || !path.isAbsolute(candidatePath)) {
      return { ok: false, error: 'Choose an absolute configuration file path.' };
    }
    const nextPath = path.resolve(candidatePath);
    if (nextPath === locationPath) {
      return { ok: false, error: 'Choose an app configuration, not the location pointer file.' };
    }
    if (nextPath === defaultPath) return reset();

    const validation = await validateConfigFile(nextPath);
    if (!validation.ok) return validation;

    const tempPath = `${locationPath}.${processId}.tmp`;
    await fsApi.mkdir(path.dirname(locationPath), { recursive: true });
    try {
      await fsApi.writeFile(tempPath, JSON.stringify({ configPath: nextPath }, null, 2), 'utf8');
      await fsApi.rename(tempPath, locationPath);
    } catch (error) {
      await fsApi.unlink(tempPath).catch(() => {});
      return { ok: false, error: `Could not save the configuration location: ${error.message}` };
    }
    activePath = nextPath;
    return { ok: true, ...info() };
  }

  async function reset() {
    await initialize();
    if (environmentPath) {
      return {
        ok: false,
        error: `${overrideLabel || 'The environment'} currently overrides the configuration location.`,
      };
    }
    try {
      await fsApi.unlink(locationPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return { ok: false, error: `Could not reset the configuration location: ${error.message}` };
      }
    }
    activePath = defaultPath;
    return { ok: true, ...info() };
  }

  async function migrateDefaultFrom(legacyPath) {
    await initialize();
    if (environmentPath || activePath !== defaultPath || typeof legacyPath !== 'string') {
      return { ok: true, migrated: false, ...info() };
    }
    try {
      await fsApi.access(defaultPath);
      return { ok: true, migrated: false, ...info() };
    } catch {
      // The new default does not exist yet; try the previous app-data path.
    }

    let contents;
    try {
      contents = await fsApi.readFile(legacyPath, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: true, migrated: false, ...info() };
      }
    } catch {
      return { ok: true, migrated: false, ...info() };
    }

    try {
      await fsApi.mkdir(path.dirname(defaultPath), { recursive: true });
      await fsApi.writeFile(defaultPath, contents, { encoding: 'utf8', flag: 'wx' });
      return { ok: true, migrated: true, ...info() };
    } catch (error) {
      if (error?.code === 'EEXIST') return { ok: true, migrated: false, ...info() };
      return { ok: false, migrated: false, error: error.message, ...info() };
    }
  }

  return {
    getPath: () => activePath,
    initialize,
    setPath,
    reset,
    migrateDefaultFrom,
  };
}

module.exports = { createConfigLocationStore };
