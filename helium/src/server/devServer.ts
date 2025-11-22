import type http from "http";
import type http2 from "http2";
import type https from "https";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";

import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import type { HeliumConfig } from "./config.js";
import { getSecurityConfig } from "./config.js";
import { HTTPRouter } from "./httpRouter.js";
import { RateLimiter } from "./rateLimiter.js";
import { RpcRegistry } from "./rpcRegistry.js";
import { initializeSecurity, verifyConnectionToken } from "./security.js";

type LoadHandlersFn = (registry: RpcRegistry, httpRouter: HTTPRouter) => void;
type HttpServer = http.Server | https.Server | http2.Http2Server | http2.Http2SecureServer;

let currentRegistry: RpcRegistry | null = null;
let currentHttpRouter: HTTPRouter | null = null;
let wss: WebSocketServer | null = null;
let rateLimiter: RateLimiter | null = null;

/**
 * Attaches HeliumJS HTTP handlers and WebSocket RPC server to an existing HTTP server.
 * This is used in dev mode to attach to Vite's dev server.
 */
export function attachToDevServer(httpServer: HttpServer, loadHandlers: LoadHandlersFn, config: HeliumConfig = {}) {
    // Load environment variables for server-side access
    const envVars = loadEnvFiles();
    injectEnvToProcess(envVars);

    // Initialize security with config
    const securityConfig = getSecurityConfig(config);
    initializeSecurity(securityConfig);

    // Re-initialize rate limiter with new config (always recreate in dev mode to pick up config changes)
    rateLimiter = new RateLimiter(securityConfig.maxMessagesPerWindow, securityConfig.rateLimitWindowMs, securityConfig.maxConnectionsPerIP);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter();
    httpRouter.setTrustProxyDepth(securityConfig.trustProxyDepth);
    loadHandlers(registry, httpRouter);
    registry.setRateLimiter(rateLimiter);
    currentRegistry = registry;
    currentHttpRouter = httpRouter;

    // Attach WebSocket server if not already attached
    if (!wss) {
        wss = new WebSocketServer({ noServer: true });

        wss.on("connection", (socket: WebSocket, req: http.IncomingMessage) => {
            // Extract client IP with proxy configuration
            const ip = extractClientIP(req, securityConfig.trustProxyDepth);

            // Store connection metadata for RPC context
            if (currentRegistry) {
                currentRegistry.setSocketMetadata(socket, ip, req);
            }

            // Track connection and check IP limit
            if (rateLimiter && !rateLimiter.trackConnection(socket, ip)) {
                socket.close(1008, "Too many connections from your IP");
                return;
            }

            socket.on("message", (msg: WebSocket.RawData) => {
                // Check rate limit
                if (rateLimiter && !rateLimiter.checkRateLimit(socket)) {
                    // Parse request to get the ID for proper error response
                    try {
                        const req = JSON.parse(msg.toString());
                        const stats = rateLimiter.getConnectionStats(socket);
                        const now = Date.now();
                        const resetInSeconds = stats ? Math.ceil((stats.resetTimeMs - now) / 1000) : 0;

                        const errorResponse = {
                            id: req.id,
                            ok: false,
                            stats: {
                                remainingRequests: stats ? stats.remainingMessages : 0,
                                resetInSeconds,
                            },
                            error: "Rate limit exceeded",
                        };
                        socket.send(JSON.stringify(errorResponse));
                    } catch {
                        // If we can't parse the request, just close the connection
                        socket.close();
                    }
                    return;
                }

                // Always use the current registry (may have been updated)
                if (currentRegistry) {
                    currentRegistry.handleMessage(socket, msg.toString());
                }
            });
        });

        // Handle WebSocket upgrade requests
        httpServer.on("upgrade", (req, socket, head) => {
            if (req.url?.startsWith("/rpc")) {
                const url = new URL(req.url, "http://localhost");
                const token = url.searchParams.get("token");

                if (!token || !verifyConnectionToken(token)) {
                    log("warn", "WebSocket connection rejected - invalid token");
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                // Check IP connection limit before upgrading
                const ip = extractClientIP(req, securityConfig.trustProxyDepth);
                if (rateLimiter && securityConfig.maxConnectionsPerIP > 0) {
                    const currentConnections = rateLimiter.getIPConnectionCount(ip);
                    if (currentConnections >= securityConfig.maxConnectionsPerIP) {
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

    // Attach HTTP request handler
    // We need to intercept requests before Vite handles them
    const originalListeners = httpServer.listeners("request").slice();
    httpServer.removeAllListeners("request");

    httpServer.on("request", async (req: any, res: any) => {
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
