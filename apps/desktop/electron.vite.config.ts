import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const internalPackages = [
  '@ipm/shared',
  '@ipm/security',
  '@ipm/database',
  '@ipm/networking',
  '@ipm/messaging',
  '@ipm/file-sharing',
  '@ipm/calling',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: internalPackages })],
    resolve: {
      alias: {
        '@ipm/shared': resolve(__dirname, '../../packages/shared/src'),
        '@ipm/security': resolve(__dirname, '../../packages/security/src'),
        '@ipm/database': resolve(__dirname, '../../packages/database/src'),
        '@ipm/networking': resolve(__dirname, '../../packages/networking/src'),
        '@ipm/messaging': resolve(__dirname, '../../packages/messaging/src'),
        '@ipm/file-sharing': resolve(__dirname, '../../packages/file-sharing/src'),
        '@ipm/calling/client': resolve(__dirname, '../../packages/calling/src/client.ts'),
        '@ipm/calling': resolve(__dirname, '../../packages/calling/src'),
      },
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts'),
      },
      rollupOptions: {
        external: ['better-sqlite3', '@node-rs/argon2'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: internalPackages })],
    resolve: {
      alias: {
        '@ipm/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@ipm/shared': resolve(__dirname, '../../packages/shared/src'),
        '@ipm/calling/client': resolve(__dirname, '../../packages/calling/src/client.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    plugins: [react()],
  },
});
