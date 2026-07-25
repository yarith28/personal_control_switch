import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const rootDir = process.cwd();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(rootDir, 'out/main'),
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/main/index.js'),
          'git-process': resolve(rootDir, 'src/main/git-process.js'),
          'config-store': resolve(rootDir, 'src/main/config-store.js'),
          'config-location': resolve(rootDir, 'src/main/config-location.js'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(rootDir, 'out/preload'),
      rollupOptions: {
        input: resolve(rootDir, 'src/preload/index.js'),
      },
    },
  },
  renderer: {
    root: resolve(rootDir, 'src/renderer'),
    base: './',
    build: {
      outDir: resolve(rootDir, 'out/renderer'),
      rollupOptions: {
        input: resolve(rootDir, 'src/renderer/index.html'),
      },
    },
  },
});
