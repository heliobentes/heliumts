/// <reference types="vite/client" />

interface ImportMeta {
    glob<T = any>(pattern: string, options?: { eager?: boolean }): Record<string, T>;
}

interface Window {
    __HELIUM__?: {
        env?: Record<string, string>;
    };
}