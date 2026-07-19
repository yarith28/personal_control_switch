const fs = require('node:fs/promises');
const path = require('node:path');

function defaultConfig() {
  return { projects: [] };
}

function normalizeConfig(parsed) {
  const config = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : defaultConfig();
  return {
    ...config,
    projects: Array.isArray(config.projects) ? config.projects : [],
  };
}

function backupPathFor(configPath) {
  const extension = path.extname(configPath);
  const base = extension ? configPath.slice(0, -extension.length) : configPath;
  return `${base}.backup${extension || '.json'}`;
}

function corruptPathFor(configPath, timestamp) {
  const extension = path.extname(configPath);
  const base = extension ? configPath.slice(0, -extension.length) : configPath;
  const safeTimestamp = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  return `${base}.corrupt-${safeTimestamp}${extension || '.json'}`;
}

function createConfigStore({
  getConfigPath,
  fsApi = fs,
  now = () => Date.now(),
  processId = process.pid,
} = {}) {
  if (typeof getConfigPath !== 'function') {
    throw new TypeError('getConfigPath must be a function');
  }

  let updateQueue = Promise.resolve();
  let pendingRecovery = null;

  async function readJson(filePath) {
    const text = await fsApi.readFile(filePath, 'utf8');
    return normalizeConfig(JSON.parse(text));
  }

  async function isValidJsonFile(filePath) {
    try {
      await readJson(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function atomicWrite(config, { preserveCurrent = true } = {}) {
    const configPath = getConfigPath();
    const backupPath = backupPathFor(configPath);
    const tempPath = `${configPath}.${processId}.${now()}.tmp`;
    const normalized = normalizeConfig(config);

    await fsApi.mkdir(path.dirname(configPath), { recursive: true });
    if (preserveCurrent && await isValidJsonFile(configPath)) {
      await fsApi.copyFile(configPath, backupPath);
    }

    try {
      await fsApi.writeFile(tempPath, JSON.stringify(normalized, null, 2), 'utf8');
      await fsApi.rename(tempPath, configPath);
    } catch (error) {
      await fsApi.unlink(tempPath).catch(() => {});
      throw error;
    }
    return normalized;
  }

  async function recoverConfig(configPath, originalError) {
    const backupPath = backupPathFor(configPath);
    const corruptPath = corruptPathFor(configPath, now());
    let preservedPath = '';

    try {
      await fsApi.copyFile(configPath, corruptPath);
      preservedPath = corruptPath;
    } catch {
      // A permission or disappearance race can prevent preservation. Recovery
      // can still continue from a known-good backup.
    }

    try {
      const recovered = await readJson(backupPath);
      await atomicWrite(recovered, { preserveCurrent: false });
      pendingRecovery = {
        title: 'Configuration restored',
        message: preservedPath
          ? `The saved configuration was unreadable, so the last known-good backup was restored. The damaged file was preserved at ${preservedPath}.`
          : 'The saved configuration was unreadable, so the last known-good backup was restored.',
        tone: 'warning',
      };
      return recovered;
    } catch {
      const fresh = defaultConfig();
      try {
        await atomicWrite(fresh, { preserveCurrent: false });
      } catch {
        // If the directory is not writable, preserve the original read error
        // context in the notice and continue with an in-memory empty config.
      }
      pendingRecovery = {
        title: 'Configuration could not be read',
        message: preservedPath
          ? `No usable backup was available. A fresh project list was opened and the damaged file was preserved at ${preservedPath}.`
          : `No usable backup was available. A fresh project list was opened. ${originalError.message}`,
        tone: 'error',
      };
      return fresh;
    }
  }

  async function load({ reportRecovery = false } = {}) {
    const configPath = getConfigPath();
    let config;
    try {
      config = await readJson(configPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        config = defaultConfig();
      } else {
        config = await recoverConfig(configPath, error);
      }
    }

    if (reportRecovery && pendingRecovery) {
      const recovery = pendingRecovery;
      pendingRecovery = null;
      return { ...config, configRecovery: recovery };
    }
    return config;
  }

  function update(mutator) {
    const task = updateQueue
      .catch(() => {})
      .then(async () => {
        const config = await load();
        await mutator(config);
        delete config.configRecovery;
        return atomicWrite(config);
      });
    updateQueue = task;
    return task;
  }

  return {
    load,
    update,
    paths() {
      const configPath = getConfigPath();
      return { configPath, backupPath: backupPathFor(configPath) };
    },
  };
}

module.exports = {
  backupPathFor,
  corruptPathFor,
  createConfigStore,
  normalizeConfig,
};
