import type http from "http";

/**
 * Context passed to RPC method handlers.
 * Contains request information and cancellation metadata.
 */
export interface HeliumContext {
    /** Aborted when the caller disconnects. Pass to upstream fetch/LLM providers. */
    signal: AbortSignal;
    /**
     * The current HTTP request.
     * Contains headers, client IP, and request metadata.
     */
    req: {
        /**
         * The client's IP address, extracted based on trustProxyDepth configuration.
         */
        ip: string;
        /**
         * HTTP request headers.
         */
        headers: http.IncomingHttpHeaders;
        /**
         * The HTTP request URL.
         */
        url?: string;
        /**
         * The HTTP request method.
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
