import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";
import { RpcError } from "./RpcError.js";

export type RpcResult<T> = { data: T; stats: RpcStats };

// The Vite plugin supplies the server's token lifetime and batch cap.
declare const __HELIUM_RPC_TOKEN_VALIDITY_MS__: number;
declare const __HELIUM_RPC_MAX_BATCH_SIZE__: number;
const tokenValidityMs =
    typeof __HELIUM_RPC_TOKEN_VALIDITY_MS__ !== "undefined" && Number.isFinite(__HELIUM_RPC_TOKEN_VALIDITY_MS__) && __HELIUM_RPC_TOKEN_VALIDITY_MS__ > 0
        ? __HELIUM_RPC_TOKEN_VALIDITY_MS__
        : 30_000;
const maxBatchSize =
    typeof __HELIUM_RPC_MAX_BATCH_SIZE__ !== "undefined" && Number.isInteger(__HELIUM_RPC_MAX_BATCH_SIZE__) && __HELIUM_RPC_MAX_BATCH_SIZE__ > 0
        ? __HELIUM_RPC_MAX_BATCH_SIZE__
        : 20;
const REQUEST_TIMEOUT_MS = 30_000;
let cachedToken: string | undefined;
let tokenExpiresAt = 0;
let tokenRequest: Promise<string> | null = null;
let requestId = 0;

export function createRpcRequest<TArgs>(method: string, args?: TArgs): RpcRequest {
    return { id: requestId++, method, args };
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(signal.reason);
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

async function getToken(signal: AbortSignal, rejectedToken?: string): Promise<string> {
    if (cachedToken === rejectedToken) {
        cachedToken = undefined;
    }
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }
    if (!tokenRequest) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        tokenRequest = (async () => {
            const response = await fetch("/__helium__/refresh-token", {
                method: "POST",
                headers: { "X-Requested-With": "HeliumRPC" },
                credentials: "same-origin",
                cache: "no-store",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new RpcError(`RPC authorization failed (${response.status})`);
            }
            const result = (await response.json()) as { token?: unknown };
            if (typeof result.token !== "string" || !result.token) {
                throw new RpcError("Invalid RPC authorization response");
            }
            const issuedAt = Number.parseInt(result.token.split(".")[0], 10);
            const safetyWindow = Math.min(5_000, tokenValidityMs * 0.2);
            cachedToken = result.token;
            tokenExpiresAt = (Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : Date.now()) + tokenValidityMs - safetyWindow;
            return cachedToken;
        })()
            .catch((error) => {
                if (controller.signal.aborted) {
                    throw new RpcError("RPC authorization timed out");
                }
                throw error;
            })
            .finally(() => {
                clearTimeout(timeout);
                tokenRequest = null;
            });
    }
    // A cancelled caller must not cancel another caller's shared token request.
    return waitWithSignal(tokenRequest, signal);
}

/** Shared HTTP request authentication for unary and streaming calls. */
export async function postRpc(endpoint: "/__helium__/rpc" | "/__helium__/stream", request: RpcRequest | RpcRequest[], signal: AbortSignal): Promise<Response> {
    const body = msgpackEncode(request) as Uint8Array<ArrayBuffer>;
    const send = (token: string) => {
        signal.throwIfAborted();
        return fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/msgpack", "X-Helium-Token": token },
            credentials: "same-origin",
            cache: "no-store",
            body,
            signal,
        });
    };
    const token = await getToken(signal);
    let response = await send(token);
    if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        response = await send(await getToken(signal, token));
    }
    if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new RpcError(`RPC request failed (${response.status})`);
    }
    return response;
}

export function isRpcStats(value: unknown): value is RpcStats {
    if (!value || typeof value !== "object") {
        return false;
    }
    const stats = value as RpcStats;
    return typeof stats.remainingRequests === "number" && stats.remainingRequests >= 0 && typeof stats.resetInSeconds === "number" && stats.resetInSeconds >= 0;
}

type PendingRequest = {
    request: RpcRequest;
    resolve: (value: RpcResult<unknown>) => void;
    reject: (reason: unknown) => void;
};
let pending: PendingRequest[] = [];
let scheduled = false;

async function sendBatch(batch: PendingRequest[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await postRpc(
            "/__helium__/rpc",
            batch.map((item) => item.request),
            controller.signal
        );
        const decoded = msgpackDecode(new Uint8Array(await response.arrayBuffer()));
        const responses = Array.isArray(decoded) ? decoded : [decoded];
        const byId = new Map<string | number, RpcResponse>();
        for (const value of responses) {
            if (value && typeof value === "object" && (typeof value.id === "string" || typeof value.id === "number") && typeof value.ok === "boolean" && isRpcStats(value.stats)) {
                byId.set(value.id, value as RpcResponse);
            }
        }
        for (const item of batch) {
            const result = byId.get(item.request.id);
            if (!result) {
                item.reject(new RpcError("Invalid or missing RPC response"));
            } else if (result.ok) {
                item.resolve({ data: result.result, stats: result.stats });
            } else {
                item.reject(new RpcError(typeof result.error === "string" ? result.error : "Invalid RPC error response", result.stats));
            }
        }
    } catch (error) {
        const failure = controller.signal.aborted ? new RpcError("Request timed out") : error;
        batch.forEach((item) => item.reject(failure));
    } finally {
        clearTimeout(timeout);
    }
}

/** Call an RPC method over HTTP; simultaneous calls share capped batch envelopes. */
export function rpcCall<TResult = unknown, TArgs = unknown>(method: string, args?: TArgs): Promise<RpcResult<TResult>> {
    const result = new Promise<RpcResult<unknown>>((resolve, reject) => pending.push({ request: createRpcRequest(method, args), resolve, reject }));
    if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            const batch = pending;
            pending = [];
            for (let offset = 0; offset < batch.length; offset += maxBatchSize) {
                void sendBatch(batch.slice(offset, offset + maxBatchSize));
            }
        });
    }
    // Network failures are not replayed: a lost response may follow a successful mutation.
    return result as Promise<RpcResult<TResult>>;
}
