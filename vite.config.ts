import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Serves the demo page (`pnpm demo`), which imports the library from src/.
// The library itself is built by `tsc` (`pnpm build`), not Vite.
export default defineConfig({
  root: resolve(import.meta.dirname, 'demo'),
});
