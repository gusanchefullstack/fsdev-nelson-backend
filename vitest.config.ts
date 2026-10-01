import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], setupFiles: ['tests/setup-temporal.ts'] } },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup-temporal.ts', 'tests/setup-integration.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
