import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";
import { RpcError } from "./RpcError.js";

export type RpcResult<T> = {
    data: T;
    stats: RpcStats;
};

function toArrayBuffer(data: Uint8Array<ArrayBufferLike>): ArrayBuffer {
    if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data.buffer;
    }
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    return buffer;
}

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
declare const __HELIUM_RPC_TOKEN_VALIDITY_MS__: number;

// Read build-time config with fallback defaults
const configuredTransport: RpcTransport = typeof __HELIUM_RPC_TRANSPORT__ !== "undefined" ? __HELIUM_RPC_TRANSPORT__ : "websocket";
const configuredAutoHttpOnMobile: boolean = typeof __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__ !== "undefined" ? __HELIUM_RPC_AUTO_HTTP_ON_MOBILE__ : false;
const configuredTokenValidityMs: number =
    typeof __HELIUM_RPC_TOKEN_VALIDITY_MS__ !== "undefined" && Number.isFinite(__HELIUM_RPC_TOKEN_VALIDITY_MS__) && __HELIUM_RPC_TOKEN_VALIDITY_MS__ > 0
        ? __HELIUM_RPC_TOKEN_VALIDITY_MS__
        : 30_000;

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

interface NetworkInformation {
    type?: string;
    effectiveType?: string;
}

interface NavigatorWithConnection extends Navigator {
    connection?: NetworkInformation;
    userAgentData?: {
        mobile?: boolean;
    };
}

function isMobileDevice(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }

    const MOBILE_BREAKPOINT_MAX_WIDTH = 1024; // 1024px or less is a common breakpoint for mobile devices

    const nav = navigator as NavigatorWithConnection;
    if (nav.userAgentData?.mobile === true) {
        return true;
    }

    const userAgent = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobi/i.test(userAgent)) {
        return true;
    }

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_MAX_WIDTH}px)`).matches) {
            return true;
        }

        if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(any-pointer: coarse)").matches) {
            return true;
        }
    }

    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

// Detect if we should prefer HTTP transport (mobile/slow networks)
function shouldUseHttpTransport(): boolean {
    if (isTemporaryHttpFallbackActive()) {
        return true;
    }

    if (isMobileDevice()) {
        return true;
    }

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

    // For non-mobile devices, prefer HTTP on slow/cellular connections
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

    const sendWithToken = async (token: string | undefined) => {
        const headers: Record<string, string> = {
            "Content-Type": "application/msgpack",
            Accept: "application/msgpack",
        };
        if (token) {
            headers["X-Helium-Token"] = token;
        }

        return fetch("/__helium__/rpc", {
            method: "POST",
            headers,
            body: encoded as unknown as BodyInit,
        });
    };

    let response = await sendWithToken(await fetchFreshToken());

    if (response.status === 401) {
        const refreshedToken = await fetchFreshToken(true);
        if (refreshedToken) {
            response = await sendWithToken(refreshedToken);
        }
    }

    handleBlockedResponse(response.status, "rpc-http");
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
                item.reject(new RpcError(res.error, res.stats));
            }
        } else {
            item.reject(new RpcError("No response for request"));
        }
    }
}

async function sendBatchWebSocket(batch: PendingRequest[]) {
    const ws = await ensureSocketReady();
    const requests = batch.map((b) => b.req);

    // Register pending promises with timeout safeguards
    batch.forEach((item) => {
        trackPending(item.req.id, (v: unknown) => item.resolve(v as RpcResult<any>), item.reject);
    });

    try {
        // Always use msgpack encoding
        const encoded = msgpackEncode(requests);
        ws.send(toArrayBuffer(encoded));
    } catch (err) {
        batch.forEach((item) => {
            removePending(item.req.id);
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
const pendingTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();

// ── Block detection (rate-limited reload) ──────────────────────────────────

type BlockedSource = "refresh-token" | "rpc-http" | "rpc-websocket";

const BLOCKED_HTTP_STATUSES = new Set([401, 403, 429]);
const BLOCKED_WS_CLOSE_CODES = new Set([1008, 1011, 1013]);
const BLOCKED_RETRY_THRESHOLD = 3;
const BLOCKED_RETRY_WINDOW_MS = 1_000;
const BLOCKED_RELOAD_COOLDOWN_MS = 120_000;
const BLOCKED_RELOAD_KEY = "helium:blocked-reload-ts";

const blockedAttempts = new Map<BlockedSource, { count: number; lastTs: number }>();
let lastBlockedReloadAt = 0;

function shouldAutoReloadOnBlock(now: number): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const stored = window.sessionStorage.getItem(BLOCKED_RELOAD_KEY);
        const storedTs = stored ? Number(stored) : 0;
        if (storedTs && now - storedTs < BLOCKED_RELOAD_COOLDOWN_MS) {
            return false;
        }
        window.sessionStorage.setItem(BLOCKED_RELOAD_KEY, String(now));
        return true;
    } catch {
        if (now - lastBlockedReloadAt < BLOCKED_RELOAD_COOLDOWN_MS) {
            return false;
        }
        lastBlockedReloadAt = now;
        return true;
    }
}

function shouldTriggerBlockedAction(source: BlockedSource, now: number): boolean {
    const state = blockedAttempts.get(source);
    if (!state || now - state.lastTs > BLOCKED_RETRY_WINDOW_MS) {
        blockedAttempts.set(source, { count: 1, lastTs: now });
        return false;
    }
    const nextCount = state.count + 1;
    blockedAttempts.set(source, { count: nextCount, lastTs: now });
    return nextCount > BLOCKED_RETRY_THRESHOLD;
}

function dispatchBlockedEvent(detail: { source: BlockedSource; status?: number; code?: number }): void {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent("helium:blocked", {
            detail,
        })
    );
}

function handleBlockedResponse(status: number, source: BlockedSource): void {
    if (!BLOCKED_HTTP_STATUSES.has(status)) {
        return;
    }
    const now = Date.now();
    if (!shouldTriggerBlockedAction(source, now)) {
        return;
    }

    dispatchBlockedEvent({ status, source });

    if (shouldAutoReloadOnBlock(now) && typeof window.location?.reload === "function") {
        window.location.reload();
    }
}

function handleBlockedSocketClose(code: number): void {
    if (!BLOCKED_WS_CLOSE_CODES.has(code)) {
        return;
    }
    const now = Date.now();
    if (!shouldTriggerBlockedAction("rpc-websocket", now)) {
        return;
    }

    dispatchBlockedEvent({ code, source: "rpc-websocket" });
    if (shouldAutoReloadOnBlock(now) && typeof window.location?.reload === "function") {
        window.location.reload();
    }
}

// ── Connection resilience constants ──────────────────────────────────────────

/** How long (ms) the page must be hidden before we consider the WebSocket stale. */
const STALE_THRESHOLD_MS = 15_000;

/** Max time (ms) to wait for a WebSocket connection to open. */
const SOCKET_CONNECT_TIMEOUT_MS = 10_000;

/** Duration (ms) to temporarily force HTTP after repeated WebSocket failures. */
const WS_FAILURE_HTTP_COOLDOWN_MS = 60_000;

/** Max time (ms) to wait for a response before timing out a request. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Number of automatic retries on retriable connection errors. */
const MAX_RETRIES = 3;

/** Base delay (ms) for exponential backoff between retries (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 500;

/** Maximum delay (ms) cap for backoff to avoid excessively long waits. */
const RETRY_MAX_DELAY_MS = 5_000;

/** Timestamp when the page was last hidden (for visibility-change detection). */
let lastHiddenTimestamp: number | null = null;
let forceHttpUntilTimestamp = 0;

function isTemporaryHttpFallbackActive(now = Date.now()): boolean {
    return now < forceHttpUntilTimestamp;
}

function activateTemporaryHttpFallback(now = Date.now()): void {
    forceHttpUntilTimestamp = now + WS_FAILURE_HTTP_COOLDOWN_MS;
}

// ── Pending-request helpers ──────────────────────────────────────────────────

/**
 * Register a pending request with an automatic timeout safeguard.
 * If no response arrives within REQUEST_TIMEOUT_MS the promise is rejected
 * so the caller's retry logic can kick in.
 */
function trackPending(id: string | number, resolve: (v: unknown) => void, reject: (e: unknown) => void): void {
    pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (entry) {
            pending.delete(id);
            pendingTimeouts.delete(id);
            entry.reject(new RpcError("Request timed out"));
        }
    }, REQUEST_TIMEOUT_MS);
    pendingTimeouts.set(id, timer);
}

/**
 * Remove a pending request and clear its timeout.
 * Returns the entry so the caller can resolve/reject it.
 */
function removePending(id: string | number): { resolve: (v: unknown) => void; reject: (e: unknown) => void } | undefined {
    const entry = pending.get(id);
    if (!entry) {
        return undefined;
    }
    pending.delete(id);
    const timer = pendingTimeouts.get(id);
    if (timer) {
        clearTimeout(timer);
        pendingTimeouts.delete(id);
    }
    return entry;
}

/** Reject every in-flight request (e.g. when the socket closes unexpectedly). */
function rejectAllPending(reason: Error): void {
    for (const timer of pendingTimeouts.values()) {
        clearTimeout(timer);
    }
    pendingTimeouts.clear();
    const entries = [...pending.entries()];
    pending.clear();
    for (const [, entry] of entries) {
        entry.reject(reason);
    }
}

// ── Reconnection helpers ─────────────────────────────────────────────────────

/**
 * Force-close the current WebSocket so the next call creates a fresh
 * connection (which fetches a brand-new token).
 */
function forceReconnect(): void {
    const oldSocket = socket;
    socket = null;
    connectionPromise = null;

    if (oldSocket) {
        // Detach handlers to avoid double-rejecting pending from the close event
        oldSocket.onclose = null;
        oldSocket.onerror = null;
        oldSocket.onmessage = null;
        oldSocket.close();
    }

    // Reject all in-flight requests – callers with retry logic will resend
    rejectAllPending(new Error("Connection reset"));
}

function reconnectIfLikelyStale(force = false): void {
    if (!socket) {
        lastHiddenTimestamp = null;
        return;
    }

    if (force) {
        forceReconnect();
        lastHiddenTimestamp = null;
        return;
    }

    if (lastHiddenTimestamp !== null) {
        const hiddenDuration = Date.now() - lastHiddenTimestamp;
        if (hiddenDuration > STALE_THRESHOLD_MS) {
            forceReconnect();
        }
    }

    lastHiddenTimestamp = null;
}

/** Determine whether an error warrants an automatic retry. */
function isRetriableError(err: unknown): boolean {
    // Network / connection errors are always retriable
    if (err instanceof Error && !(err instanceof RpcError)) {
        return true;
    }
    // Timed-out requests are retriable (socket may have died silently)
    if (err instanceof RpcError && err.message === "Request timed out") {
        return true;
    }
    return false;
}

// Clean up WebSocket connection on HMR (Hot Module Replacement)
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (socket) {
            socket.onclose = null;
            socket.close();
            socket = null;
            connectionPromise = null;
        }
        clearTokenRefreshTimer();
        rejectAllPending(new Error("Module reloaded"));
    });
}

let msgId = 0;
function nextId() {
    return msgId++;
}

let cachedAuthToken: string | undefined;
let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const TOKEN_REFRESH_MIN_DELAY_MS = 5_000;
const TOKEN_REFRESH_RETRY_DELAY_MS = 5_000;
const TOKEN_REFRESH_SAFETY_WINDOW_MS = Math.min(5_000, Math.max(1_000, Math.floor(configuredTokenValidityMs * 0.2)));

function clearTokenRefreshTimer(): void {
    if (!tokenRefreshTimer) {
        return;
    }
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
}

function parseTokenIssuedAt(token: string): number | null {
    const [timestampPart] = token.split(".");
    if (!timestampPart) {
        return null;
    }
    const issuedAt = Number.parseInt(timestampPart, 10);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
        return null;
    }
    return issuedAt;
}

function scheduleTokenRefreshFromToken(token: string): void {
    if (typeof window === "undefined") {
        return;
    }

    const issuedAt = parseTokenIssuedAt(token);
    if (!issuedAt) {
        clearTokenRefreshTimer();
        return;
    }

    const expiresAt = issuedAt + configuredTokenValidityMs;
    const refreshAt = expiresAt - TOKEN_REFRESH_SAFETY_WINDOW_MS;
    const delay = Math.max(TOKEN_REFRESH_MIN_DELAY_MS, refreshAt - Date.now());

    clearTokenRefreshTimer();
    tokenRefreshTimer = setTimeout(() => {
        void fetchFreshToken(true).then((nextToken) => {
            if (!nextToken) {
                clearTokenRefreshTimer();
                tokenRefreshTimer = setTimeout(() => {
                    void fetchFreshToken(true);
                }, TOKEN_REFRESH_RETRY_DELAY_MS);
            }
        });
    }, delay);
}

function hasCachedToken(): boolean {
    return Boolean(cachedAuthToken);
}

function setCachedToken(token: string | undefined): void {
    if (!token) {
        cachedAuthToken = undefined;
        clearTokenRefreshTimer();
        return;
    }

    cachedAuthToken = token;
    scheduleTokenRefreshFromToken(token);
}

async function fetchFreshToken(forceRefresh = false): Promise<string | undefined> {
    if (!forceRefresh && hasCachedToken()) {
        return cachedAuthToken;
    }

    try {
        const response = await fetch("/__helium__/refresh-token", {
            method: "POST",
            headers: {
                "X-Requested-With": "HeliumRPC",
            },
        });
        handleBlockedResponse(response.status, "refresh-token");
        if (!response.ok) {
            console.warn("Failed to fetch fresh token:", response.status);
            setCachedToken(undefined);
            return undefined;
        }
        const data = await response.json();
        const token = data.token as string | undefined;
        setCachedToken(token);
        return token;
    } catch (error) {
        console.warn("Error fetching fresh token:", error);
        setCachedToken(undefined);
        return undefined;
    }
}

async function createSocket(): Promise<WebSocket> {
    // Fetch a token before creating the WebSocket connection
    const token = await fetchFreshToken();

    // Use the same protocol, hostname and port as the current page
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // includes hostname and port
    const url = `${protocol}//${host}/rpc`;
    // Security: pass token via Sec-WebSocket-Protocol header instead of query string
    const ws = token ? new WebSocket(url, [token]) : new WebSocket(url);
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
                        const reader = decompressed.getReader();
                        const chunks: Uint8Array[] = [];
                        let totalSize = 0;
                        const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024; // 10 MB
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) {
                                break;
                            }
                            totalSize += value.length;
                            if (totalSize > MAX_DECOMPRESSED_SIZE) {
                                reader.cancel();
                                console.error("Decompressed message exceeds size limit");
                                return;
                            }
                            chunks.push(value);
                        }
                        const combined = new Uint8Array(totalSize);
                        let offset = 0;
                        for (const chunk of chunks) {
                            combined.set(chunk, offset);
                            offset += chunk.length;
                        }
                        data = combined;
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
            const entry = removePending(res.id);
            if (!entry) {
                return;
            }
            if (res.ok) {
                entry.resolve({ data: res.result, stats: res.stats });
            } else {
                entry.reject(new RpcError(res.error, res.stats));
            }
        };

        if (Array.isArray(msg)) {
            msg.forEach(handleResponse);
        } else {
            handleResponse(msg);
        }
    };

    ws.onerror = () => {
        // WebSocket errors are always followed by a close event.
        // The close handler takes care of rejecting pending promises.
    };

    ws.onclose = (event) => {
        handleBlockedSocketClose(event.code);
        if (socket === ws) {
            socket = null;
            connectionPromise = null;
            // Reject every in-flight request so callers can retry
            rejectAllPending(new Error("WebSocket connection closed"));
        }
    };

    return ws;
}

function waitForSocketOpen(ws: WebSocket): Promise<WebSocket> {
    if (ws.readyState === WebSocket.OPEN) {
        return Promise.resolve(ws);
    }

    return new Promise<WebSocket>((resolve, reject) => {
        const cleanup = () => {
            ws.removeEventListener("open", handleOpen);
            ws.removeEventListener("error", handleError);
            ws.removeEventListener("close", handleClose);
            clearTimeout(timeout);
        };

        const handleOpen = () => {
            cleanup();
            resolve(ws);
        };

        const handleError = () => {
            cleanup();
            if (socket === ws) {
                socket = null;
            }
            setCachedToken(undefined);
            reject(new Error("WebSocket connection failed"));
        };

        const handleClose = () => {
            cleanup();
            if (socket === ws) {
                socket = null;
            }
            setCachedToken(undefined);
            reject(new Error("WebSocket closed before opening"));
        };

        const timeout = setTimeout(() => {
            cleanup();
            if (socket === ws) {
                socket = null;
            }
            setCachedToken(undefined);
            reject(new Error("WebSocket connection timed out"));
        }, SOCKET_CONNECT_TIMEOUT_MS);

        ws.addEventListener("open", handleOpen);
        ws.addEventListener("error", handleError);
        ws.addEventListener("close", handleClose);
    });
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

    const pendingConnectPromise = (async () => {
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
            socket = await createSocket();
        }

        return waitForSocketOpen(socket);
    })();

    connectionPromise = pendingConnectPromise;

    try {
        return await pendingConnectPromise;
    } finally {
        if (connectionPromise === pendingConnectPromise) {
            connectionPromise = null;
        }
    }
}

async function rpcCallWebSocket<TResult, TArgs>(methodId: string, args?: TArgs): Promise<RpcResult<TResult>> {
    // Optimization: If socket is open, send immediately without awaiting ensureSocketReady (which adds a microtask tick)
    if (socket && socket.readyState === WebSocket.OPEN) {
        const id = nextId();
        const req: RpcRequest = { id, method: methodId, args };
        return new Promise<RpcResult<TResult>>((resolve, reject) => {
            trackPending(id, (v: unknown) => resolve(v as RpcResult<TResult>), reject);
            try {
                const encoded = msgpackEncode(req);
                socket!.send(toArrayBuffer(encoded));
            } catch (err) {
                removePending(id);
                reject(err);
            }
        });
    }

    const ws = await ensureSocketReady();
    const id = nextId();

    const req: RpcRequest = { id, method: methodId, args };

    return new Promise<RpcResult<TResult>>((resolve, reject) => {
        trackPending(id, (v: unknown) => resolve(v as RpcResult<TResult>), reject);
        try {
            // Always use msgpack encoding
            const encoded = msgpackEncode(req);
            ws.send(toArrayBuffer(encoded));
        } catch (err) {
            removePending(id);
            reject(err);
        }
    });
}

/**
 * Make an RPC call using the appropriate transport.
 * Automatically selects HTTP or WebSocket based on network conditions and configuration.
 *
 * Includes automatic retry logic: if a call fails due to a connection error
 * (e.g. stale WebSocket after mobile browser was backgrounded), the client
 * forces a fresh connection (with a new token) and retries once.
 */
export async function rpcCall<TResult = unknown, TArgs = unknown>(methodId: string, args?: TArgs): Promise<RpcResult<TResult>> {
    return rpcCallWithRetry<TResult, TArgs>(methodId, args);
}

async function rpcCallViaHttpBatch<TResult, TArgs>(methodId: string, args: TArgs | undefined): Promise<RpcResult<TResult>> {
    const id = nextId();
    const req: RpcRequest = { id, method: methodId, args };

    return new Promise<RpcResult<TResult>>((resolve, reject) => {
        pendingBatch.push({ req, resolve: resolve as (value: RpcResult<TResult>) => void, reject });
        scheduleBatch();
    });
}

async function rpcCallWithRetry<TResult, TArgs>(methodId: string, args: TArgs | undefined, attempt = 0): Promise<RpcResult<TResult>> {
    try {
        if (shouldUseHttpTransport()) {
            return await rpcCallViaHttpBatch<TResult, TArgs>(methodId, args);
        }

        return await rpcCallWebSocket<TResult, TArgs>(methodId, args);
    } catch (err) {
        if (attempt < MAX_RETRIES && isRetriableError(err)) {
            // Force a fresh connection (fetches a new token)
            forceReconnect();
            // Exponential backoff with jitter: 500ms, 1000ms, 2000ms (capped at 5s)
            const baseDelay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
            const jitter = Math.random() * baseDelay * 0.3;
            await new Promise<void>((r) => setTimeout(r, baseDelay + jitter));
            return rpcCallWithRetry<TResult, TArgs>(methodId, args, attempt + 1);
        }

        if (isRetriableError(err) && configuredTransport !== "http") {
            activateTemporaryHttpFallback();
            return rpcCallViaHttpBatch<TResult, TArgs>(methodId, args);
        }

        throw err;
    }
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

// ============================================================================
// Visibility-change reconnection (critical for mobile browsers)
// ============================================================================
//
// Mobile browsers freeze or kill WebSocket connections when the tab is
// backgrounded.  When the user returns the socket may *appear* open but
// is actually stale.  We detect this via the Page Visibility API and
// proactively tear down the old connection so the next RPC call creates
// a fresh one (with a brand-new auth token).
// ============================================================================

if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            lastHiddenTimestamp = Date.now();
        } else {
            reconnectIfLikelyStale(false);
        }
    });

    document.addEventListener("pagehide", () => {
        lastHiddenTimestamp = Date.now();
    });
}

if (typeof window !== "undefined") {
    window.addEventListener("pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted) {
            reconnectIfLikelyStale(true);
            return;
        }
        reconnectIfLikelyStale(false);
    });

    window.addEventListener("focus", () => {
        reconnectIfLikelyStale(false);
    });

    window.addEventListener("online", () => {
        reconnectIfLikelyStale(true);
    });
}
