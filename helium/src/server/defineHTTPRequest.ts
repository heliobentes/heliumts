export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL";

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
    toWebRequest: () => Promise<Request>;
}

export type HTTPHandler<TResult = unknown> = (req: HTTPRequest, ctx: unknown) => Promise<TResult> | TResult;

export type HeliumHTTPDef<TMethod extends HTTPMethod = HTTPMethod, TPath extends string = string> = {
    __kind: "http";
    method: TMethod;
    path: TPath;
    handler: HTTPHandler;
};

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
