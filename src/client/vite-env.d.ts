/// <reference types="vite/client" />

interface ImportMeta {
    glob<T = any>(pattern: string, options?: { eager?: boolean }): Record<string, T>;
}

interface Window {
    __HELIUM_PUBLIC_ENV__?: Record<string, string>;
}