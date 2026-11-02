import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * RPC security and rate limiting configuration.
 * Controls per-IP HTTP request limits and token-based protection.
 */
export interface HeliumRpcSecurityConfig {
    /**
     * Maximum number of HTTP RPC requests allowed per client IP within the time window.
     * Helps prevent abuse by limiting HTTP request throughput per client.
     * Set to 0 to disable rate limiting.
     *
     * @default 100
     */
    maxRequestsPerWindow?: number;

    /**
     * Time window in milliseconds for rate limiting.
     * Rate limits reset after this duration.
     *
     * @default 60000 (1 minute)
     */
    rateLimitWindowMs?: number;

    /**
     * HTTP RPC token validity duration in milliseconds.
     * Tokens are generated server-side and must be used within this timeframe.
     * Shorter durations improve security but may cause issues with slow networks.
     *
     * @default 30000 (30 seconds)
     */
    tokenValidityMs?: number;
}

/**
 * Security configuration for HTTP responses.
 */
export interface HeliumSecurityConfig {
    /**
     * Apply Helium's built-in default security headers.
     *
     * When set to `false`, Helium will not set default security headers,
     * allowing full manual control via `headerOverrides` and your own server logic.
     *
     * @default true
     */
    defaultHeaders?: boolean;

    /**
     * Header overrides applied after Helium's default security headers.
     *
     * - Set a header value to override (or add) that header.
     * - Set a header value to `null` to remove that header.
     *
     * This is useful for custom framing policies, custom permissions policy,
     * or disabling a specific default header.
     */
    headerOverrides?: Record<string, string | null>;

    /**
     * Content-Security-Policy header value.
     * Set to a CSP string to enable, or omit to skip CSP.
     * Applied when `defaultHeaders` is enabled.
     *
     * @default undefined (no CSP header)
     */
    contentSecurityPolicy?: string;

    /**
     * Enable Strict-Transport-Security header.
     * Set to false to disable HSTS.
     * Applied when `defaultHeaders` is enabled.
     *
     * @default true
     */
    hsts?: boolean;

    /**
     * Allowed CORS origins.
     * Set to ["*"] to allow all origins, or provide specific origins.
     * Empty array or omit to restrict to same-origin only (default, most secure).
     *
     * @default [] (same-origin only)
     */
    corsOrigins?: string[];
}

/**
 * Helium framework configuration.
 *
 * Configure your Helium application behavior including HTTP RPC settings,
 * security, and proxy configuration for production deployments.
 */
export interface HeliumConfig {
    /**
     * Number of proxy levels to trust when extracting client IP addresses.
     *
     * This setting is crucial for deployments behind reverse proxies, load balancers,
     * or CDNs (like Vercel, Cloudflare, AWS ALB, etc.). It determines how the framework
     * extracts the real client IP from headers like X-Forwarded-For.
     *
     * **How it works:**
     * When behind proxies, the X-Forwarded-For header contains a chain of IPs:
     * `X-Forwarded-For: <client-ip>, <proxy1-ip>, <proxy2-ip>`
     *
     * This setting tells Helium how many proxy IPs to skip from the right to find the real client IP.
     *
     * **Values:**
     * - `0`: Don't trust any proxies, use direct connection IP (default, most secure)
     * - `1`: Trust 1 proxy level (recommended for most platforms: Vercel, Netlify, Railway)
     * - `2+`: Trust multiple proxy levels (for complex setups like Cloudflare → Load Balancer → Your Server)
     *
     * **Common configurations:**
     * - Local development: `0`
     * - Vercel/Netlify/Railway: `1`
     * - Cloudflare → Your server: `1` or `2`
     * - AWS ALB → EC2: `1`
     * - Nginx → Node.js: `1`
     * - Cloudflare → AWS ALB → EC2: `2`
     *
     * **Security note:** Setting this too high can allow IP spoofing. Only trust as many
     * proxy levels as you actually have in your infrastructure.
     *
     * This setting applies to HTTP requests.
     *
     * @default 0
     */
    trustProxyDepth?: number;

    /**
     * HTTP response security configuration.
     * Controls CORS, CSP, HSTS, and other security headers.
     */
    security?: HeliumSecurityConfig;

    /**
     * HTTP RPC configuration.
     *
     * Configure HTTP RPC request limits and security settings.
     */
    rpc?: {
        /**
         * RPC security and rate limiting configuration.
         *
         * Configure connection limits, message rate limits, and token validity
         * to protect your RPC endpoints from abuse.
         */
        security?: HeliumRpcSecurityConfig;

        /**
         * Maximum HTTP request body size in bytes.
         * Requests exceeding this limit receive a 413 status.
         *
         * @default 1048576 (1 MB)
         */
        maxBodySize?: number;

        /**
         * Maximum number of RPC calls in a single batch request.
         * Batches exceeding this limit are rejected.
         *
         * @default 20
         */
        maxBatchSize?: number;
    };
}

const DEFAULT_RPC_SECURITY: Required<HeliumRpcSecurityConfig> = {
    maxRequestsPerWindow: 100,
    rateLimitWindowMs: 60000,
    tokenValidityMs: 30000,
};

const cachedConfigs = new Map<string, HeliumConfig>();

/**
 * Load Helium configuration from the project root.
 * Searches for helium.config.js, helium.config.mjs, or helium.config.ts.
 * Results are cached for the lifetime of the process.
 *
 * In production, the build process automatically transpiles .ts config files
 * to .js in the dist directory. The loader checks dist/ first when available.
 *
 * @internal - Used by framework internals only
 */
export async function loadConfig(root: string = process.cwd()): Promise<HeliumConfig> {
    // Check if there's a custom config directory (used in production)
    const configDir = process.env.HELIUM_CONFIG_DIR || root;
    const cacheKey = JSON.stringify([path.resolve(root), path.resolve(configDir)]);
    const cachedConfig = cachedConfigs.get(cacheKey);
    if (cachedConfig) {
        return cachedConfig;
    }

    const configFiles = ["helium.config.js", "helium.config.mjs", "helium.config.ts"];
    const searchPaths = configDir !== root ? [configDir, root] : [root];

    for (const searchPath of searchPaths) {
        for (const configFile of configFiles) {
            const configPath = path.resolve(searchPath, configFile);
            if (!fs.existsSync(configPath)) {
                continue;
            }
            try {
                const module = await importConfig(configPath);
                const config = module.default;
                if (!config || typeof config !== "object" || Array.isArray(config)) {
                    throw new Error("Expected a configuration object as the default export");
                }
                cachedConfigs.set(cacheKey, config);
                return config;
            } catch (error) {
                // Never silently replace security settings with defaults after a load failure.
                throw new Error(`Failed to load Helium config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    const config = {};
    cachedConfigs.set(cacheKey, config);
    return config;
}

async function importConfig(configPath: string): Promise<{ default?: HeliumConfig }> {
    if (!configPath.endsWith(".ts")) {
        return import(/* @vite-ignore */ `${pathToFileURL(configPath).href}?t=${randomUUID()}`);
    }

    // Node 20 cannot execute TypeScript. Bundle local helpers as well as stripping types.
    const { build } = await import("esbuild");
    const result = await build({
        entryPoints: [configPath],
        bundle: true,
        packages: "external",
        platform: "node",
        format: "esm",
        target: "node20",
        write: false,
        logLevel: "silent",
    });
    // Keep package resolution and import.meta.url relative to the original config directory.
    const tempPath = path.join(path.dirname(configPath), `.helium-config-${randomUUID()}.mjs`);
    try {
        fs.writeFileSync(tempPath, result.outputFiles[0].text);
        return await import(/* @vite-ignore */ pathToFileURL(tempPath).href);
    } finally {
        fs.rmSync(tempPath, { force: true });
    }
}

/**
 * Get the proxy trust depth from config.
 * Used for extracting client IPs from X-Forwarded-For headers.
 *
 * @internal - Used by framework internals only
 */
export function getTrustProxyDepth(config: HeliumConfig = {}): number {
    return config.trustProxyDepth ?? 0;
}

/**
 * Get RPC security configuration with defaults applied.
 * Returns HTTP rate limiting and token settings.
 *
 * @internal - Used by framework internals only
 */
export function getRpcSecurityConfig(config: HeliumConfig = {}): Required<HeliumRpcSecurityConfig> {
    const src = config.rpc?.security;

    return {
        maxRequestsPerWindow: src?.maxRequestsPerWindow ?? DEFAULT_RPC_SECURITY.maxRequestsPerWindow,
        rateLimitWindowMs: src?.rateLimitWindowMs ?? DEFAULT_RPC_SECURITY.rateLimitWindowMs,
        tokenValidityMs: src?.tokenValidityMs ?? DEFAULT_RPC_SECURITY.tokenValidityMs,
    };
}

/**
 * Get HTTP RPC configuration, including request limits and security.
 *
 * @internal - Used by framework internals only
 */
export function getRpcConfig(config: HeliumConfig = {}) {
    return {
        security: getRpcSecurityConfig(config),
        maxBodySize: config.rpc?.maxBodySize ?? 1_048_576,
        maxBatchSize: config.rpc?.maxBatchSize ?? 20,
    };
}

/**
 * Client-side HTTP RPC configuration.
 * This is injected into the client bundle at build time.
 */
export interface RpcClientConfig {
    tokenValidityMs: number;
}

/**
 * Get client-side HTTP RPC configuration.
 * This configuration is injected into the client bundle via Vite defines.
 *
 * @internal - Used by framework internals only
 */
export function getRpcClientConfig(config: HeliumConfig = {}): RpcClientConfig {
    return {
        tokenValidityMs: getRpcSecurityConfig(config).tokenValidityMs,
    };
}

/**
 * Clear the cached configuration.
 * Useful for testing or when you need to reload config.
 *
 * @internal - Used by framework internals only
 */
export function clearConfigCache() {
    cachedConfigs.clear();
}
