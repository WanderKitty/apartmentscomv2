import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 300_000, // live-API suites iterate 50 queries / 12 judged samples
    fileParallelism: false,
  },
})
