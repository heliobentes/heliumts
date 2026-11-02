import type { HeliumContext } from "./context.js";

export type HTTPMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "ALL";

export interface HTTPRequest {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string>;
    params: Record<string, string>;
    cookies: Record<string, string>;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
    formData: () => Promise<FormData>;
    /**
     * Convert the normalized Helium HTTPRequest into a standard Web `Request`.
     *
     * This is useful when integrating with APIs or libraries that expect the
     * Fetch/Web Request API (for example, third-party auth handlers or cloud SDKs).
     * The implementation will build a Request with matching method, headers
     * and body where appropriate.
     *
     * @returns a Promise resolving to a Web `Request` instance representing the same request
     */
    toWebRequest: () => Promise<Request>;
}

export type HTTPHandler<TResult = unknown> = (req: HTTPRequest, ctx: HeliumContext) => Promise<TResult> | TResult;

export type HeliumHTTPDef<TMethod extends HTTPMethod = HTTPMethod, TPath extends string = string> = {
    __kind: "http";
    method: TMethod;
    path: TPath;
    handler: HTTPHandler;
};

/**
 * Define an HTTP endpoint for the server.
 *
 * Handlers created with `defineHTTPRequest(method, path, handler)` are
 * discoverable by the Vite plugin and will be registered as server HTTP
 * endpoints. The provided handler receives a normalized `HTTPRequest` and
 * the Helium context.
 *
 * @typeParam TMethod - exact HTTP method literal (GET/POST/etc.)
 * @typeParam TPath - the path string used to discover and register the handler
 * @typeParam TResult - expected return type
 * @param method - HTTP verb or "ALL" for any method
 * @param path - route path
 * @param handler - function handling the request
 * @returns a HeliumHTTPDef used for server registration
 */
export function defineHTTPRequest<TMethod extends HTTPMethod, TPath extends string, TResult = unknown>(
    method: TMethod,
    path: TPath,
    handler: HTTPHandler<TResult>
): HeliumHTTPDef<TMethod, TPath> {
    if (!method) {
        throw new Error("defineHTTPRequest requires a method (GET, POST, etc.)");
    }
    if (!path) {
        throw new Error("defineHTTPRequest requires a path");
    }
    if (!handler) {
        throw new Error("defineHTTPRequest requires a handler");
    }

    return {
        __kind: "http",
        method,
        path,
        handler,
    };
}
