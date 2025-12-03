import { afterEach, vi } from "vitest";

// Reset all mocks after each test
afterEach(() => {
    vi.restoreAllMocks();
});

// Mock console methods to keep test output clean (optional)
// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});
