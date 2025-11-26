import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * WebSocket per-message compression configuration.
 * Uses the permessage-deflate extension to compress messages on the wire.
 */
export interface HeliumCompressionConfig {
    /**
     * Enable WebSocket per-message compression (permessage-deflate extension).
     * When enabled, messages are compressed before sending to reduce bandwidth usage.
     *
     * @default true
     */
    enabled?: boolean;

    /**
     * Minimum message size in bytes to apply compression.
     * Messages smaller than this threshold will not be compressed to avoid overhead.
     * Only applies when compression is enabled.
     *
     * @default 1024 (1KB)
     */
    threshold?: number;
}

/**
 * RPC security and rate limiting configuration.
 * Controls WebSocket connection limits, message rate limits, and token-based authentication.
 */
export interface HeliumRpcSecurityConfig {
    /**
     * Maximum number of concurrent WebSocket connections allowed per IP address.
     * Helps prevent a single client from exhausting connection resources.
     * Set to 0 to disable this limit.
     *
     * @default 10
     */
    maxConnectionsPerIP?: number;

    /**
     * Maximum number of RPC messages allowed per connection within the time window.
     * Helps prevent abuse by limiting message throughput per connection.
     * Set to 0 to disable rate limiting.
     *
     * @default 100
     */
    maxMessagesPerWindow?: number;

    /**
     * Time window in milliseconds for rate limiting.
     * Rate limits reset after this duration.
     *
     * @default 60000 (1 minute)
     */
    rateLimitWindowMs?: number;

    /**
     * WebSocket connection token validity duration in milliseconds.
     * Tokens are generated server-side and must be used within this timeframe.
     * Shorter durations improve security but may cause issues with slow networks.
     *
     * @default 30000 (30 seconds)
     */
    tokenValidityMs?: number;
}

/**
 * Helium framework configuration.
 *
 * Configure your Helium application behavior including RPC transport settings,
 * compression, security, and proxy configuration for production deployments.
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
     * This setting applies to both HTTP requests and WebSocket connections.
     *
     * @default 0
     */
    trustProxyDepth?: number;

    /**
     * RPC transport configuration.
     *
     * Configure the WebSocket-based RPC layer including message encoding,
     * compression, and security settings.
     */
    rpc?: {
        /**
         * Message encoding format for RPC communication.
         *
         * Choose how messages are serialized over the WebSocket connection:
         *
         * - `"msgpack"` (default): Binary MessagePack encoding
         *   - ✅ Smaller payload size (~30-50% smaller than JSON)
         *   - ✅ Faster serialization/deserialization
         *   - ✅ Better performance for large data structures
         *   - ⚠️ Not human-readable in browser DevTools
         *
         * - `"json"`: Standard JSON text encoding
         *   - ✅ Human-readable in browser network inspector
         *   - ✅ Easier debugging and development
         *   - ✅ No special dependencies required
         *   - ⚠️ Larger payload size
         *   - ⚠️ Slower for complex data structures
         *
         * **Note:** The server accepts both formats simultaneously, so you can
         * switch between them without breaking existing clients.
         *
         * @default "msgpack"
         */
        encoding?: "json" | "msgpack";

        /**
         * Client-side transport mode for RPC calls.
         *
         * - `"websocket"` (default): Uses persistent WebSocket connection
         *   - ✅ Lower latency for subsequent calls (connection reuse)
         *   - ✅ Real-time bidirectional communication ready
         *   - ⚠️ Higher initial connection overhead
         *
         * - `"http"`: Uses HTTP POST requests for each RPC call
         *   - ✅ Better performance on mobile/cellular networks (HTTP/2 optimizations)
         *   - ✅ No connection state to maintain
         *   - ⚠️ Slightly higher per-request overhead on fast networks
         *
         * - `"auto"`: Automatically selects based on network conditions
         *   - Uses HTTP on cellular/slow networks when `autoHttpOnMobile` is true
         *   - Uses WebSocket on fast networks (WiFi, wired)
         *
         * @default "websocket"
         */
        transport?: "http" | "websocket" | "auto";

        /**
         * Automatically switch to HTTP transport on mobile/cellular networks.
         *
         * When enabled and `transport` is `"auto"`, the client will use HTTP
         * instead of WebSocket on cellular connections (4G/LTE, 5G) and slow
         * connections (2G, 3G). This improves performance on mobile networks
         * where HTTP/2 is more efficient due to carrier network optimizations.
         *
         * @default false
         */
        autoHttpOnMobile?: boolean;

        /**
         * WebSocket per-message compression configuration.
         *
         * Enable and configure the permessage-deflate extension to compress
         * messages on the wire, reducing bandwidth usage.
         */
        compression?: HeliumCompressionConfig;

        /**
         * RPC security and rate limiting configuration.
         *
         * Configure connection limits, message rate limits, and token validity
         * to protect your RPC endpoints from abuse.
         */
        security?: HeliumRpcSecurityConfig;
    };
}

const DEFAULT_RPC_SECURITY: Required<HeliumRpcSecurityConfig> = {
    maxConnectionsPerIP: 10,
    maxMessagesPerWindow: 100,
    rateLimitWindowMs: 60000,
    tokenValidityMs: 30000,
};

const DEFAULT_COMPRESSION: Required<HeliumCompressionConfig> = {
    enabled: true,
    threshold: 1024,
};

let cachedConfig: HeliumConfig | null = null;

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
    if (cachedConfig) {
        return cachedConfig;
    }

    // Check if there's a custom config directory (used in production)
    const configDir = process.env.HELIUM_CONFIG_DIR || root;

    // Prioritize .js/.mjs (work in both dev and production)
    // .ts files work in dev with Vite but fail in production without transpilation
    const configFiles = ["helium.config.js", "helium.config.mjs", "helium.config.ts"];

    // In production with HELIUM_CONFIG_DIR set, check dist directory first
    const searchPaths = configDir !== root ? [configDir, root] : [root];

    for (const searchPath of searchPaths) {
        for (const configFile of configFiles) {
            const configPath = path.join(searchPath, configFile);
            if (fs.existsSync(configPath)) {
                try {
                    const fileUrl = pathToFileURL(configPath).href;
                    const module = await import(/* @vite-ignore */ `${fileUrl}?t=${Date.now()}`);
                    const config = module.default || {};
                    cachedConfig = config;
                    return config;
                } catch (err) {
                    // In production, .ts files will fail to load without a TypeScript loader
                    if (configFile.endsWith(".ts") && err instanceof Error && "code" in err && err.code === "ERR_UNKNOWN_FILE_EXTENSION") {
                        console.warn(`[Helium] Cannot load ${configFile} in production. The build process should have transpiled it.`);
                    } else {
                        console.warn(`[Helium] Failed to load config from ${configFile}:`, err);
                    }
                }
            }
        }
    }

    cachedConfig = {};
    return cachedConfig;
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
 * Returns rate limiting, connection limits, and token settings.
 *
 * @internal - Used by framework internals only
 */
export function getRpcSecurityConfig(config: HeliumConfig = {}): Required<HeliumRpcSecurityConfig> {
    const src = config.rpc?.security;

    return {
        maxConnectionsPerIP: src?.maxConnectionsPerIP ?? DEFAULT_RPC_SECURITY.maxConnectionsPerIP,
        maxMessagesPerWindow: src?.maxMessagesPerWindow ?? DEFAULT_RPC_SECURITY.maxMessagesPerWindow,
        rateLimitWindowMs: src?.rateLimitWindowMs ?? DEFAULT_RPC_SECURITY.rateLimitWindowMs,
        tokenValidityMs: src?.tokenValidityMs ?? DEFAULT_RPC_SECURITY.tokenValidityMs,
    };
}

/**
 * Get WebSocket compression configuration with defaults applied.
 *
 * @internal - Used by framework internals only
 */
export function getCompressionConfig(config: HeliumConfig = {}): Required<HeliumCompressionConfig> {
    const src = config.rpc?.compression;

    return {
        enabled: src?.enabled ?? DEFAULT_COMPRESSION.enabled,
        threshold: src?.threshold ?? DEFAULT_COMPRESSION.threshold,
    };
}

/**
 * Get complete RPC configuration including encoding, compression, and security.
 *
 * @internal - Used by framework internals only
 */
export function getRpcConfig(config: HeliumConfig = {}) {
    return {
        encoding: (config.rpc?.encoding ?? "msgpack") as "json" | "msgpack",
        compression: getCompressionConfig(config),
        security: getRpcSecurityConfig(config),
    };
}

/**
 * Client-side RPC transport configuration.
 * This is injected into the client bundle at build time.
 */
export interface RpcClientTransportConfig {
    transport: "http" | "websocket" | "auto";
    autoHttpOnMobile: boolean;
}

/**
 * Get client-side RPC transport configuration.
 * This configuration is injected into the client bundle via Vite defines.
 *
 * @internal - Used by framework internals only
 */
export function getRpcClientConfig(config: HeliumConfig = {}): RpcClientTransportConfig {
    return {
        transport: config.rpc?.transport ?? "websocket",
        autoHttpOnMobile: config.rpc?.autoHttpOnMobile ?? false,
    };
}

/**
 * Clear the cached configuration.
 * Useful for testing or when you need to reload config.
 *
 * @internal - Used by framework internals only
 */
export function clearConfigCache() {
    cachedConfig = null;
}
