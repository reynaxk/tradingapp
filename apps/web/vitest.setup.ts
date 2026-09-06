import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's own auto-cleanup only registers when it finds `afterEach` on
// globalThis, which requires Vitest's `globals: true`. This project imports test helpers
// explicitly instead (matching every other package's tests), so cleanup is wired here.
afterEach(() => {
  cleanup();
});
