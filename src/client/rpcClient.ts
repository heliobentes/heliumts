import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";

export type RpcResult<T> = {
    data: T;
    stats: RpcStats;
};

/**
 * Transport mode for RPC calls.
 * - "http": Uses HTTP POST requests (faster on mobile/high-latency networks, benefits from HTTP/2)
 * - "websocket": Uses persistent WebSocket connection (lower latency on desktop/low-latency networks)
 * - "auto": Automatically selects based on connection type
 */
export type RpcTransport = "http" | "websocket" | "auto";

// Build-time configuration injected by Vite plugin from helium.config.js
declare const __HELIUM_RPC_TRANSPORT__: RpcTransport;
declare const __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__: boolean;

// Read build-time config with fallback defaults
const configuredTransport: RpcTransport = typeof __HELIUM_RPC_TRANSPORT__ !== "undefined" ? __HELIUM_RPC_TRANSPORT__ : "websocket";
const configuredAutoHttpOnMobile: boolean = typeof __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__ !== "undefined" ? __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__ : false;

/**
 * Get the configured RPC transport mode (from helium.config.js).
 */
export function getRpcTransport(): RpcTransport {
    return configuredTransport;
}

/**
 * Check if auto HTTP on mobile is enabled (from helium.config.js).
 */
export function isAutoHttpOnMobileEnabled(): boolean {
    return configuredAutoHttpOnMobile;
}

// Detect if we should prefer HTTP transport (mobile/slow networks)
function shouldUseHttpTransport(): boolean {
    if (configuredTransport === "http") {
        return true;
    }
    if (configuredTransport === "websocket") {
        return false;
    }

    // Auto mode: check if mobile HTTP optimization is enabled
    if (!configuredAutoHttpOnMobile) {
        return false;
    }

    // Prefer HTTP on mobile/slow connections
    if (typeof navigator !== "undefined") {
        const conn = (navigator as NavigatorWithConnection).connection;
        if (conn) {
            // Use HTTP for cellular connections or slow effective types
            const slowTypes = ["slow-2g", "2g", "3g"];
            if (conn.type === "cellular" || (conn.effectiveType && slowTypes.includes(conn.effectiveType))) {
                return true;
            }
        }
    }

    return false;
}

interface NetworkInformation {
    type?: string;
    effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
    connection?: NetworkInformation;
}

// ============================================================================
// Batching Logic
// ============================================================================

type PendingRequest = {
    req: RpcRequest;
    resolve: (value: RpcResult<any>) => void;
    reject: (reason?: any) => void;
};

let pendingBatch: PendingRequest[] = [];
let isBatchScheduled = false;

function scheduleBatch() {
    if (isBatchScheduled) {
        return;
    }
    isBatchScheduled = true;
    queueMicrotask(() => {
        isBatchScheduled = false;
        flushBatch();
    });
}

async function flushBatch() {
    const batch = pendingBatch;
    pendingBatch = [];

    if (batch.length === 0) {
        return;
    }

    try {
        if (shouldUseHttpTransport()) {
            await sendBatchHttp(batch);
        } else {
            await sendBatchWebSocket(batch);
        }
    } catch (err) {
        // Transport error, fail all
        for (const item of batch) {
            item.reject(err);
        }
    }
}

async function sendBatchHttp(batch: PendingRequest[]) {
    const requests = batch.map((b) => b.req);
    const encoded = msgpackEncode(requests);

    const response = await fetch("/__helium__/rpc", {
        method: "POST",
        headers: {
            "Content-Type": "application/msgpack",
            Accept: "application/msgpack",
        },
        body: encoded as unknown as BodyInit,
    });

    if (!response.ok) {
        throw new Error(`HTTP RPC failed: ${response.status}`);
    }

    const responseBuffer = await response.arrayBuffer();
    const msg = msgpackDecode(new Uint8Array(responseBuffer)) as RpcResponse | RpcResponse[];

    const responses = Array.isArray(msg) ? msg : [msg];
    const responseMap = new Map(responses.map((r) => [r.id, r]));

    for (const item of batch) {
        const res = responseMap.get(item.req.id);
        if (res) {
            if (res.ok) {
                item.resolve({ data: res.result, stats: res.stats });
            } else {
                item.reject({ error: res.error, stats: res.stats });
            }
        } else {
            item.reject(new Error("No response for request"));
        }
    }
}

async function sendBatchWebSocket(batch: PendingRequest[]) {
    const ws = await ensureSocketReady();
    const requests = batch.map((b) => b.req);

    // Register pending promises
    batch.forEach((item) => {
        pending.set(item.req.id, {
            resolve: (v: unknown) => item.resolve(v as RpcResult<any>),
            reject: item.reject,
        });
    });

    try {
        // Always use msgpack encoding
        const encoded = msgpackEncode(requests);
        ws.send(encoded);
    } catch (err) {
        batch.forEach((item) => {
            pending.delete(item.req.id);
            item.reject(err);
        });
    }
}

// ============================================================================
// WebSocket Transport (original implementation)
// ============================================================================

let socket: WebSocket | null = null;
let connectionPromise: Promise<WebSocket> | null = null;

const pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

// Clean up WebSocket connection on HMR (Hot Module Replacement)
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (socket) {
            // Close the socket gracefully
            socket.close();
            socket = null;
            connectionPromise = null;
        }
        // Reject all pending requests
        pending.forEach((entry) => {
            entry.reject(new Error("Module reloaded"));
        });
        pending.clear();
    });
}

let msgId = 0;
function nextId() {
    return msgId++;
}

async function fetchFreshToken(): Promise<string | undefined> {
    try {
        const response = await fetch("/__helium__/refresh-token");
        if (!response.ok) {
            console.warn("Failed to fetch fresh token:", response.status);
            return undefined;
        }
        const data = await response.json();
        return data.token;
    } catch (error) {
        console.warn("Error fetching fresh token:", error);
        return undefined;
    }
}

async function createSocket(): Promise<WebSocket> {
    // Fetch a fresh token before creating the WebSocket connection
    const token = await fetchFreshToken();

    // Use the same protocol, hostname and port as the current page
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // includes hostname and port
    const url = `${protocol}//${host}/rpc${token ? `?token=${token}` : ""}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onmessage = async (event) => {
        let data = new Uint8Array(event.data as ArrayBuffer);

        // Check for Gzip header (0x1f 0x8b) to detect compressed messages
        if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) {
            try {
                // Use DecompressionStream if available (Chrome 80+, Firefox 113+, Safari 16.4+)
                if (typeof DecompressionStream !== "undefined") {
                    const ds = new DecompressionStream("gzip");
                    const stream = new Response(data).body;
                    if (stream) {
                        const decompressed = stream.pipeThrough(ds);
                        const buffer = await new Response(decompressed).arrayBuffer();
                        data = new Uint8Array(buffer);
                    }
                }
            } catch (err) {
                console.error("Failed to decompress WebSocket message:", err);
                return;
            }
        }

        // Always expect binary MessagePack
        const msg = msgpackDecode(data) as RpcResponse | RpcResponse[];

        const handleResponse = (res: RpcResponse) => {
            const entry = pending.get(res.id);
            if (!entry) {
                return;
            }
            pending.delete(res.id);
            if (res.ok) {
                entry.resolve({ data: res.result, stats: res.stats });
            } else {
                entry.reject({ error: res.error, stats: res.stats });
            }
        };

        if (Array.isArray(msg)) {
            msg.forEach(handleResponse);
        } else {
            handleResponse(msg);
        }
    };

    ws.onclose = () => {
        if (socket === ws) {
            socket = null;
            connectionPromise = null;
        }
    };

    return ws;
}

async function ensureSocketReady(): Promise<WebSocket> {
    // If we have an open socket, return it immediately
    if (socket && socket.readyState === WebSocket.OPEN) {
        return socket;
    }

    // If we have a connection in progress, reuse that promise
    if (connectionPromise) {
        return connectionPromise;
    }

    // If we have a socket that's connecting, wait for it
    if (socket && socket.readyState === WebSocket.CONNECTING) {
        connectionPromise = new Promise((resolve, reject) => {
            const cleanup = () => {
                socket!.removeEventListener("open", handleOpen);
                socket!.removeEventListener("error", handleError);
                socket!.removeEventListener("close", handleClose);
            };
            const handleOpen = () => {
                cleanup();
                connectionPromise = null;
                resolve(socket!);
            };
            const handleError = () => {
                cleanup();
                socket = null;
                connectionPromise = null;
                reject(new Error("WebSocket connection failed"));
            };
            const handleClose = () => {
                cleanup();
                socket = null;
                connectionPromise = null;
                reject(new Error("WebSocket closed before opening"));
            };

            socket!.addEventListener("open", handleOpen);
            socket!.addEventListener("error", handleError);
            socket!.addEventListener("close", handleClose);
        });
        return connectionPromise;
    }

    // Create a new socket and connection promise
    connectionPromise = (async () => {
        socket = await createSocket();
        return new Promise<WebSocket>((resolve, reject) => {
            const cleanup = () => {
                socket!.removeEventListener("open", handleOpen);
                socket!.removeEventListener("error", handleError);
                socket!.removeEventListener("close", handleClose);
            };
            const handleOpen = () => {
                cleanup();
                connectionPromise = null;
                resolve(socket!);
            };
            const handleError = () => {
                cleanup();
                socket = null;
                connectionPromise = null;
                reject(new Error("WebSocket connection failed"));
            };
            const handleClose = () => {
                cleanup();
                socket = null;
                connectionPromise = null;
                reject(new Error("WebSocket closed before opening"));
            };

            socket!.addEventListener("open", handleOpen);
            socket!.addEventListener("error", handleError);
            socket!.addEventListener("close", handleClose);
        });
    })();

    return connectionPromise;
}

async function rpcCallWebSocket<TResult, TArgs>(methodId: string, args?: TArgs): Promise<RpcResult<TResult>> {
    // Optimization: If socket is open, send immediately without awaiting ensureSocketReady (which adds a microtask tick)
    if (socket && socket.readyState === WebSocket.OPEN) {
        const id = nextId();
        const req: RpcRequest = { id, method: methodId, args };
        return new Promise<RpcResult<TResult>>((resolve, reject) => {
            pending.set(id, {
                resolve: (v: unknown) => resolve(v as RpcResult<TResult>),
                reject,
            });
            try {
                const encoded = msgpackEncode(req);
                socket!.send(encoded);
            } catch (err) {
                pending.delete(id);
                reject(err);
            }
        });
    }

    const ws = await ensureSocketReady();
    const id = nextId();

    const req: RpcRequest = { id, method: methodId, args };

    return new Promise<RpcResult<TResult>>((resolve, reject) => {
        pending.set(id, {
            resolve: (v: unknown) => resolve(v as RpcResult<TResult>),
            reject,
        });
        try {
            // Always use msgpack encoding
            const encoded = msgpackEncode(req);
            ws.send(encoded);
        } catch (err) {
            pending.delete(id);
            reject(err);
        }
    });
}

/**
 * Make an RPC call using the appropriate transport.
 * Automatically selects HTTP or WebSocket based on network conditions and configuration.
 */
export async function rpcCall<TResult = unknown, TArgs = unknown>(methodId: string, args?: TArgs): Promise<RpcResult<TResult>> {
    if (shouldUseHttpTransport()) {
        const id = nextId();
        const req: RpcRequest = { id, method: methodId, args };

        return new Promise<RpcResult<TResult>>((resolve, reject) => {
            pendingBatch.push({ req, resolve: resolve as any, reject });
            scheduleBatch();
        });
    }

    return rpcCallWebSocket<TResult, TArgs>(methodId, args);
}

/**
 * Pre-establishes the WebSocket connection.
 * Call this early (e.g., on page load) to avoid connection latency on first RPC call.
 * This is especially beneficial on high-latency networks like mobile LTE.
 * Note: Only effective when using WebSocket transport (not HTTP transport).
 */
export function preconnect(): void {
    if (typeof window === "undefined") {
        return;
    }
    // Only preconnect if we're using WebSocket transport
    if (shouldUseHttpTransport()) {
        return;
    }
    // Fire and forget - establishes connection in background
    ensureSocketReady().catch(() => {
        // Silently ignore preconnect failures, will retry on actual call
    });
}

// Auto-preconnect when the module loads (browser only, WebSocket transport only)
if (typeof window !== "undefined" && typeof document !== "undefined") {
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedulePreconnect = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 1));
    schedulePreconnect(() => preconnect());
}
