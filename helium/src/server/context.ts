import type http from "http";

/**
 * Context passed to RPC method handlers.
 * Contains request information and metadata about the WebSocket connection.
 */
export interface HeliumContext {
    /**
     * The HTTP request that initiated the WebSocket connection.
     * Contains headers, client IP, and other connection metadata.
     */
    req: {
        /**
         * The client's IP address, extracted based on trustProxyDepth configuration.
         */
        ip: string;
        /**
         * HTTP headers from the WebSocket upgrade request.
         */
        headers: http.IncomingHttpHeaders;
        /**
         * The URL of the WebSocket connection request.
         */
        url?: string;
        /**
         * The HTTP method (typically 'GET' for WebSocket upgrades).
         */
        method?: string;
        /**
         * The original http.IncomingMessage for advanced use cases.
         */
        raw: http.IncomingMessage;
    };
    /**
     * Custom properties can be added by middleware.
     */
    [key: string]: unknown;
}
