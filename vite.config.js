import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    watch: {
      // Power BI PBIP exports contain a locked binary cache (cache.abf) that
      // crashes the dev-server file watcher with EBUSY. Never watch them.
      ignored: ['**/docs/design-docs/**/*.pbip', '**/*.SemanticModel/**', '**/*.Report/**', '**/*.abf'],
    },
  },
});
