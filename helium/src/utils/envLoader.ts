import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export interface EnvLoadOptions {
    root?: string;
    mode?: string;
}

/**
 * Loads environment variables from .env files with priority.
 * Similar to Next.js, supports:
 * - .env.{mode}.local (highest priority)
 * - .env.local (not loaded in test mode)
 * - .env.{mode}
 * - .env
 */
export function loadEnvFiles(options: EnvLoadOptions = {}): Record<string, string> {
    const { root = process.cwd(), mode = process.env.NODE_ENV || "development" } = options;

    const envFiles = [
        `.env.${mode}.local`,
        // Don't load .env.local in test mode
        mode !== "test" ? `.env.local` : null,
        `.env.${mode}`,
        `.env`,
    ].filter(Boolean) as string[];

    const loadedEnv: Record<string, string> = {};

    // Load in reverse order so earlier files override later ones
    for (let i = envFiles.length - 1; i >= 0; i--) {
        const envFile = envFiles[i];
        const envPath = path.resolve(root, envFile);

        if (fs.existsSync(envPath)) {
            const parsed = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
            Object.assign(loadedEnv, parsed);
        }
    }

    return loadedEnv;
}

/**
 * Injects env variables into process.env
 */
export function injectEnvToProcess(env: Record<string, string>): void {
    for (const [key, value] of Object.entries(env)) {
        // Don't override existing process.env values
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

/**
 * Filters env variables that should be exposed to the client.
 * By default, only HELIUM_PUBLIC_ prefixed variables are exposed.
 */
export function filterClientEnv(env: Record<string, string>, prefix: string = "HELIUM_PUBLIC_"): Record<string, string> {
    const clientEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
        if (key.startsWith(prefix)) {
            clientEnv[key] = value;
        }
    }

    return clientEnv;
}

/**
 * Creates Vite define config for injecting env variables into the client bundle.
 */
export function createEnvDefines(env: Record<string, string>, prefix: string = "HELIUM_PUBLIC_"): Record<string, string> {
    const defines: Record<string, string> = {};
    const clientEnv = filterClientEnv(env, prefix);

    for (const [key, value] of Object.entries(clientEnv)) {
        defines[`import.meta.env.${key}`] = JSON.stringify(value);
    }

    return defines;
}
