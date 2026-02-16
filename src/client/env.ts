declare const __HELIUM_DEV__: boolean;

type GlobalWithProcess = typeof globalThis & {
    process?: {
        env?: {
            NODE_ENV?: string;
        };
    };
};

/**
 * Detect development mode without relying on Vite-specific `import.meta.env`.
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