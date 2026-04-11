declare const __HELIUM_DEV__: boolean;

export type PublicEnv = Record<string, string>;

type GlobalWithProcess = typeof globalThis & {
    process?: {
        env?: {
            NODE_ENV?: string;
        };
    };
    __HELIUM__?: {
        env?: PublicEnv;
    };
};

/**
 * Detect development mode without relying on Vite-specific client env APIs.
 */
export function isDevEnvironment(): boolean {
    if (typeof __HELIUM_DEV__ !== "undefined") {
        return __HELIUM_DEV__;
    }

    const nodeEnv = (globalThis as GlobalWithProcess).process?.env?.NODE_ENV;
    if (typeof nodeEnv === "string") {
        return nodeEnv !== "production";
    }

    return false;
}

/**
 * Reads browser-exposed public env vars from window.__HELIUM__.env.
 */
export function getPublicEnv(): PublicEnv {
    return ((globalThis as GlobalWithProcess).__HELIUM__?.env ?? {}) as PublicEnv;
}

export function getPublicEnvValue(key: string): string | undefined {
    return getPublicEnv()[key];
}