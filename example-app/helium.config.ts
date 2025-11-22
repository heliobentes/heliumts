import type { HeliumConfig } from "helium/server";

const config: HeliumConfig = {
    security: {
        /**
         * Maximum number of WebSocket connections allowed per IP address.
         * Set to 0 to disable limit.
         * @default 10
         */
        maxConnectionsPerIP: 10,

        /**
         * Maximum number of RPC messages allowed per connection per time window.
         * Set to 0 to disable rate limiting.
         * @default 500
         */
        maxMessagesPerWindow: 20,

        /**
         * Time window in milliseconds for rate limiting.
         * @default 60000 (1 minute)
         */
        rateLimitWindowMs: 10000,

        /**
         * Token validity duration in milliseconds.
         * @default 10000 (10 seconds)
         */
        tokenValidityMs: 10000,

        /**
         * Number of proxy levels to trust when extracting client IP addresses.
         * This is crucial for deployments behind proxies (Vercel, Cloudflare, AWS ALB, etc.)
         *
         * Helium checks multiple headers automatically:
         * - CF-Connecting-IP (Cloudflare)
         * - True-Client-IP (Cloudflare Enterprise, Akamai)
         * - X-Real-IP (Nginx)
         * - X-Forwarded-For (Standard)
         *
         * Set this based on your deployment environment:
         * - Local development: 0 (default)
         * - Vercel/Netlify/Railway: 1
         * - Cloudflare -> Your server: 1
         * - AWS ALB -> EC2: 1
         * - Nginx -> Node: 1
         *
         * Without this, rate limiting and connection limits might use the proxy's IP
         * instead of the real client IP, causing issues like Vercel's servers being
         * rate-limited instead of actual users.
         *
         * @default 0
         */
        trustProxyDepth: 0,
    },
};

export default config;
