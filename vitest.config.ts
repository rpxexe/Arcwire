import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@ipm/shared': resolve(__dirname, 'packages/shared/src'),
      '@ipm/security': resolve(__dirname, 'packages/security/src'),
      '@ipm/database': resolve(__dirname, 'packages/database/src'),
      '@ipm/networking': resolve(__dirname, 'packages/networking/src'),
      '@ipm/messaging': resolve(__dirname, 'packages/messaging/src'),
      '@ipm/file-sharing': resolve(__dirname, 'packages/file-sharing/src'),
      '@ipm/calling': resolve(__dirname, 'packages/calling/src')
    }
  }
});
