import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export interface HeliumSecurityConfig {
    /**
     * Maximum number of WebSocket connections allowed per IP address.
     * Set to 0 to disable limit.
     * @default 10
     */
    maxConnectionsPerIP?: number;

    /**
     * Maximum number of RPC messages allowed per connection per time window.
     * Set to 0 to disable rate limiting.
     * @default 500
     */
    maxMessagesPerWindow?: number;

    /**
     * Time window in milliseconds for rate limiting.
     * @default 60000 (1 minute)
     */
    rateLimitWindowMs?: number;

    /**
     * Token validity duration in milliseconds.
     * @default 10000 (10 seconds)
     */
    tokenValidityMs?: number;
}

export interface HeliumConfig {
    /**
     * Security and rate limiting configuration
     */
    security?: HeliumSecurityConfig;
}

const DEFAULT_CONFIG: Required<HeliumSecurityConfig> = {
    maxConnectionsPerIP: 10,
    maxMessagesPerWindow: 100,
    rateLimitWindowMs: 60000,
    tokenValidityMs: 30000,
};

let cachedConfig: HeliumConfig | null = null;

export async function loadConfig(root: string = process.cwd()): Promise<HeliumConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    const configFiles = ["helium.config.ts", "helium.config.js", "helium.config.mjs"];

    for (const configFile of configFiles) {
        const configPath = path.join(root, configFile);
        if (fs.existsSync(configPath)) {
            try {
                const fileUrl = pathToFileURL(configPath).href;
                const module = await import(/* @vite-ignore */ `${fileUrl}?t=${Date.now()}`);
                const config = module.default || {};
                cachedConfig = config;
                return config;
            } catch (err) {
                console.warn(`[Helium] Failed to load config from ${configFile}:`, err);
            }
        }
    }

    cachedConfig = {};
    return cachedConfig;
}

export function getSecurityConfig(config: HeliumConfig = {}): Required<HeliumSecurityConfig> {
    return {
        maxConnectionsPerIP: config.security?.maxConnectionsPerIP ?? DEFAULT_CONFIG.maxConnectionsPerIP,
        maxMessagesPerWindow: config.security?.maxMessagesPerWindow ?? DEFAULT_CONFIG.maxMessagesPerWindow,
        rateLimitWindowMs: config.security?.rateLimitWindowMs ?? DEFAULT_CONFIG.rateLimitWindowMs,
        tokenValidityMs: config.security?.tokenValidityMs ?? DEFAULT_CONFIG.tokenValidityMs,
    };
}

export function clearConfigCache() {
    cachedConfig = null;
}
