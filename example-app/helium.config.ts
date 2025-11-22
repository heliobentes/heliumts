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
    },
};

export default config;
