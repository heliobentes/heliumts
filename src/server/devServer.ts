import { encode as msgpackEncode } from "@msgpack/msgpack";
import type http from "http";
import type http2 from "http2";
import type https from "https";
import { promisify } from "util";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { brotliCompress, deflate, gzip } from "zlib";

import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import type { HeliumConfig } from "./config.js";
import { getRpcConfig, getRpcSecurityConfig, getTrustProxyDepth } from "./config.js";
import type { HeliumContext } from "./context.js";
import type { HeliumWorkerDef } from "./defineWorker.js";
import { startWorker, stopAllWorkers } from "./defineWorker.js";
import { HTTPRouter } from "./httpRouter.js";
import { RateLimiter } from "./rateLimiter.js";
import { RpcRegistry } from "./rpcRegistry.js";
import { initializeSecurity, verifyConnectionToken } from "./security.js";
import { prepareForMsgpack } from "./serializer.js";

const gzipAsync = promisify(gzip);
const deflateAsync = promisify(deflate);
const brotliCompressAsync = promisify(brotliCompress);

type LoadHandlersFn = (registry: RpcRegistry, httpRouter: HTTPRouter) => void;
type HttpServer = http.Server | https.Server | http2.Http2Server | http2.Http2SecureServer;

interface WorkerEntry {
    name: string;
    worker: HeliumWorkerDef;
}

let currentRegistry: RpcRegistry | null = null;
let currentHttpRouter: HTTPRouter | null = null;
let wss: WebSocketServer | null = null;
let rateLimiter: RateLimiter | null = null;
let currentWorkers: WorkerEntry[] = [];

/**
 * Attaches HeliumTS HTTP handlers and WebSocket RPC server to an existing HTTP server.
 * This is used in dev mode to attach to Vite's dev server.
 */
export function attachToDevServer(httpServer: HttpServer, loadHandlers: LoadHandlersFn, config: HeliumConfig = {}, workers: WorkerEntry[] = []) {
    // Load environment variables for server-side access
    const envVars = loadEnvFiles();
    injectEnvToProcess(envVars);

    // Load configuration
    const trustProxyDepth = getTrustProxyDepth(config);
    const rpcSecurity = getRpcSecurityConfig(config);
    const rpcConfig = getRpcConfig(config);
    const compressionConfig = rpcConfig.compression;
    initializeSecurity(rpcSecurity);

    // Re-initialize rate limiter with new config (always recreate in dev mode to pick up config changes)
    rateLimiter = new RateLimiter(rpcSecurity.maxMessagesPerWindow, rpcSecurity.rateLimitWindowMs, rpcSecurity.maxConnectionsPerIP);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter();
    httpRouter.setTrustProxyDepth(trustProxyDepth);
    loadHandlers(registry, httpRouter);
    registry.setRateLimiter(rateLimiter);
    registry.setMaxBatchSize(rpcConfig.maxBatchSize);
    currentRegistry = registry;
    currentHttpRouter = httpRouter;

    // Start workers if they changed
    const workersChanged = workers.length !== currentWorkers.length || workers.some((w, i) => w.name !== currentWorkers[i]?.name || w.worker !== currentWorkers[i]?.worker);

    if (workersChanged && workers.length > 0) {
        // Stop all existing workers before starting new ones
        stopAllWorkers().then(() => {
            // Start new workers
            for (const { name, worker } of workers) {
                // Use export name if worker name is anonymous
                if (worker.name === "anonymous") {
                    worker.name = name;
                    worker.__id = name;
                    worker.options.name = name;
                }
                if (worker.options.autoStart) {
                    const createContext = (): HeliumContext => ({
                        req: {
                            ip: "127.0.0.1",
                            headers: {},
                            url: undefined,
                            method: undefined,
                            raw: {} as http.IncomingMessage,
                        },
                    });
                    startWorker(worker, createContext).catch((err) => {
                        log("error", `Failed to start worker '${worker.name}':`, err);
                    });
                }
            }
            currentWorkers = workers;
        });
    } else if (currentWorkers.length === 0 && workers.length > 0) {
        // First time starting workers
        for (const { name, worker } of workers) {
            // Use export name if worker name is anonymous
            if (worker.name === "anonymous") {
                worker.name = name;
                worker.__id = name;
                worker.options.name = name;
            }
            if (worker.options.autoStart) {
                const createContext = (): HeliumContext => ({
                    req: {
                        ip: "127.0.0.1",
                        headers: {},
                        url: undefined,
                        method: undefined,
                        raw: {} as http.IncomingMessage,
                    },
                });
                startWorker(worker, createContext).catch((err) => {
                    log("error", `Failed to start worker '${worker.name}':`, err);
                });
            }
        }
        currentWorkers = workers;
    }

    // Attach WebSocket server if not already attached
    if (!wss) {
        wss = new WebSocketServer({
            noServer: true,
            maxPayload: rpcConfig.maxWsPayload,
            perMessageDeflate: compressionConfig.enabled
                ? {
                      zlibDeflateOptions: {
                          chunkSize: 1024,
                          memLevel: 7,
                          level: 9, // 6 is default compression level (balanced)
                      },
                      zlibInflateOptions: {
                          chunkSize: 10 * 1024,
                      },
                      threshold: compressionConfig.threshold,
                  }
                : false,
        });

        wss.on("connection", (socket: WebSocket, req: http.IncomingMessage) => {
            // Extract client IP with proxy configuration
            const ip = extractClientIP(req, trustProxyDepth);

            // Store connection metadata for RPC context
            if (currentRegistry) {
                currentRegistry.setSocketMetadata(socket, ip, req);
            }

            // Track connection and check IP limit
            if (rateLimiter && !rateLimiter.trackConnection(socket, ip)) {
                socket.close(1008, "Too many connections from your IP");
                return;
            }

            // Prevent unhandled errors from crashing the process (e.g. maxPayload exceeded)
            socket.on("error", (err) => {
                log("warn", "WebSocket error:", err);
                if (socket.readyState === socket.OPEN || socket.readyState === socket.CLOSING) {
                    socket.close(1009, "Message too large");
                }
            });

            socket.on("message", (msg: WebSocket.RawData, _isBinary: boolean) => {
                // Check rate limit
                if (rateLimiter && !rateLimiter.checkRateLimit(socket)) {
                    // Parse request to get the ID for proper error response
                    try {
                        let req: any;
                        // Always expect MessagePack
                        const buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg as any);
                        const { decode: msgpackDecode } = require("@msgpack/msgpack");
                        req = msgpackDecode(buffer);

                        const stats = rateLimiter.getConnectionStats(socket);
                        const now = Date.now();
                        const resetInSeconds = stats ? Math.ceil((stats.resetTimeMs - now) / 1000) : 0;

                        const createError = (id: string) => ({
                            id,
                            ok: false,
                            stats: {
                                remainingRequests: stats ? stats.remainingMessages : 0,
                                resetInSeconds,
                            },
                            error: "Rate limit exceeded",
                        });

                        let errorResponse: any;
                        if (Array.isArray(req)) {
                            errorResponse = req.map((r: any) => createError(r.id));
                        } else {
                            errorResponse = createError(req.id);
                        }

                        socket.send(msgpackEncode(errorResponse) as Buffer);
                    } catch {
                        // If we can't parse the request, just close the connection
                        socket.close();
                    }
                    return;
                }

                // Always use the current registry (may have been updated)
                if (currentRegistry) {
                    currentRegistry.handleMessage(socket, Buffer.isBuffer(msg) ? msg : Buffer.from(msg as any));
                }
            });
        });

        // Handle WebSocket upgrade requests
        httpServer.on("upgrade", (req, socket, head) => {
            if (req.url?.startsWith("/rpc")) {
                // Security: read token from Sec-WebSocket-Protocol header instead of query string
                const protocols = req.headers["sec-websocket-protocol"];
                const token =
                    typeof protocols === "string"
                        ? protocols
                              .split(",")
                              .map((p) => p.trim())
                              .find((p) => p.includes("."))
                        : undefined;

                if (!token || !verifyConnectionToken(token)) {
                    log("warn", "WebSocket connection rejected - invalid token");
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                // Check IP connection limit before upgrading
                const ip = extractClientIP(req, trustProxyDepth);
                if (rateLimiter && rpcSecurity.maxConnectionsPerIP > 0) {
                    const currentConnections = rateLimiter.getIPConnectionCount(ip);
                    if (currentConnections >= rpcSecurity.maxConnectionsPerIP) {
                        log("warn", `WebSocket connection rejected - IP ${ip} has ${currentConnections} connections`);
                        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
                        socket.destroy();
                        return;
                    }
                }

                wss!.handleUpgrade(req, socket, head, (ws) => {
                    wss!.emit("connection", ws, req);
                });
            }
        });

        log("info", "WebSocket RPC attached to dev server at /rpc");
    }

    // Security: max body size for HTTP requests
    const maxBodySize = rpcConfig.maxBodySize ?? 1_048_576;

    // Attach HTTP request handler
    // We need to intercept requests before Vite handles them
    const originalListeners = httpServer.listeners("request").slice();
    httpServer.removeAllListeners("request");

    httpServer.on("request", async (req: any, res: any) => {
        // Handle token refresh endpoint
        if (req.url === "/__helium__/refresh-token") {
            // Security: only allow POST to prevent CSRF via <img>/<script> tags
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Method not allowed" }));
                return;
            }
            // Security: require custom header to prevent cross-origin requests
            if (!req.headers["x-requested-with"]) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Forbidden" }));
                return;
            }
            const { generateConnectionToken } = await import("./security.js");
            const token = generateConnectionToken();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ token }));
            return;
        }

        // Handle HTTP-based RPC endpoint (alternative to WebSocket for mobile networks)
        if (req.url === "/__helium__/rpc" && req.method === "POST") {
            // Security: verify connection token for HTTP RPC
            const authToken = req.headers["x-helium-token"] as string | undefined;
            if (!authToken || !verifyConnectionToken(authToken)) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
                return;
            }

            // Security: check Content-Length before reading body
            const contentLength = parseInt(req.headers["content-length"] || "0", 10);
            if (contentLength > maxBodySize) {
                res.writeHead(413, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Request entity too large" }));
                return;
            }

            const chunks: Buffer[] = [];
            let totalSize = 0;
            let aborted = false;
            req.on("data", (chunk: Buffer) => {
                totalSize += chunk.length;
                if (totalSize > maxBodySize) {
                    aborted = true;
                    req.destroy();
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Request entity too large" }));
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", async () => {
                if (aborted) {
                    return;
                }
                try {
                    if (!currentRegistry) {
                        res.writeHead(503, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Server not ready" }));
                        return;
                    }

                    const body = Buffer.concat(chunks);
                    const ip = extractClientIP(req, trustProxyDepth);
                    const result = await currentRegistry.handleHttpRequest(body, ip, req);

                    const encoded = msgpackEncode(prepareForMsgpack(result.response));
                    let responseBody = Buffer.from(encoded as Uint8Array);
                    const headers: Record<string, string> = {
                        "Content-Type": "application/msgpack",
                        "Cache-Control": "no-store",
                    };

                    // Handle compression
                    const acceptEncoding = req.headers["accept-encoding"] as string;
                    if (acceptEncoding && responseBody.length > 1024) {
                        if (acceptEncoding.includes("br")) {
                            responseBody = await brotliCompressAsync(responseBody);
                            headers["Content-Encoding"] = "br";
                        } else if (acceptEncoding.includes("gzip")) {
                            responseBody = await gzipAsync(responseBody);
                            headers["Content-Encoding"] = "gzip";
                        } else if (acceptEncoding.includes("deflate")) {
                            responseBody = await deflateAsync(responseBody);
                            headers["Content-Encoding"] = "deflate";
                        }
                    }

                    res.writeHead(200, headers);
                    res.end(responseBody);
                } catch (error) {
                    log("error", "HTTP RPC error:", error);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
                }
            });
            return;
        }

        // Try HTTP handlers first
        if (currentHttpRouter) {
            const handled = await currentHttpRouter.handleRequest(req, res);
            if (handled) {
                return;
            }
        }

        // If no handler matched, pass to original Vite handlers
        for (const listener of originalListeners) {
            (listener as any)(req, res);
        }
    });
}
