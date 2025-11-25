import { encode as msgpackEncode } from "@msgpack/msgpack";
import fs from "fs";
import http from "http";
import path from "path";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";

import { extractClientIP } from "../utils/ipExtractor.js";
import { log } from "../utils/logger.js";
import type { HeliumConfig } from "./config.js";
import { getRpcConfig, getRpcSecurityConfig, getTrustProxyDepth } from "./config.js";
import { HTTPRouter } from "./httpRouter.js";
import { RateLimiter } from "./rateLimiter.js";
import { RpcRegistry } from "./rpcRegistry.js";
import { generateConnectionToken, initializeSecurity, verifyConnectionToken } from "./security.js";

interface ProdServerOptions {
    port?: number;
    distDir?: string;
    staticDir?: string;
    registerHandlers: (registry: RpcRegistry, httpRouter: HTTPRouter) => void;
    config?: HeliumConfig;
}

/**
 * Starts a production HTTP server that:
 * - Serves static files from the dist directory
 * - Handles custom HTTP endpoints (webhooks, auth, etc.)
 * - Hosts WebSocket RPC server
 */
export function startProdServer(options: ProdServerOptions) {
    const { port = Number(process.env.PORT || 3000), distDir = "dist", staticDir = path.resolve(process.cwd(), distDir), registerHandlers, config = {} } = options;

    // Load configuration
    const trustProxyDepth = getTrustProxyDepth(config);
    const rpcSecurity = getRpcSecurityConfig(config);
    const rpcConfig = getRpcConfig(config);
    const compressionConfig = rpcConfig.compression;
    initializeSecurity(rpcSecurity);

    // Initialize rate limiter
    const rateLimiter = new RateLimiter(rpcSecurity.maxMessagesPerWindow, rpcSecurity.rateLimitWindowMs, rpcSecurity.maxConnectionsPerIP);

    const registry = new RpcRegistry();
    registry.setRpcEncoding(rpcConfig.encoding);
    const httpRouter = new HTTPRouter();
    httpRouter.setTrustProxyDepth(trustProxyDepth);
    registerHandlers(registry, httpRouter);
    registry.setRateLimiter(rateLimiter);

    // Create HTTP server
    const server = http.createServer(async (req, res) => {
        // Handle token refresh endpoint
        if (req.url === "/__helium__/refresh-token") {
            const token = generateConnectionToken();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ token }));
            return;
        }

        // Try HTTP handlers first (webhooks, auth, etc.)
        const handled = await httpRouter.handleRequest(req, res);
        if (handled) {
            return;
        }

        // Serve static files
        const url = req.url || "/";

        // Block access to sensitive configuration and server files
        const blockedFiles = ["helium.config.js", "helium.config.mjs", "helium.config.ts", "server.js", ".env", ".env.local", ".env.production"];

        const requestedFile = path.basename(url.split("?")[0]);
        let filePath: string;
        let is404 = false;

        if (blockedFiles.some((blocked) => requestedFile === blocked || requestedFile.startsWith(".env"))) {
            // Serve index.html so the SPA router can render the 404 page
            filePath = path.join(staticDir, "index.html");
            is404 = true;
        } else {
            // Clean URL (remove query params and trailing slash)
            const cleanUrl = url.split("?")[0].replace(/\/$/, "") || "/";

            // Try different file paths for SSG support
            if (cleanUrl === "/") {
                filePath = path.join(staticDir, "index.html");
            } else {
                // First, try the exact path (for assets like /assets/main.js)
                filePath = path.join(staticDir, cleanUrl);

                // If it doesn't exist and has no extension, try appending .html (for SSG pages)
                if (!fs.existsSync(filePath) && !path.extname(cleanUrl)) {
                    const htmlPath = path.join(staticDir, cleanUrl + ".html");
                    if (fs.existsSync(htmlPath)) {
                        filePath = htmlPath;
                    }
                }
            }

            // If file doesn't exist or is a directory, fall back to index.html for SPA routing
            const isFileOrExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
            if (!isFileOrExists && !url.startsWith("/api") && !url.startsWith("/webhooks") && !url.startsWith("/auth")) {
                // Fall back to index.html for SPA routing
                filePath = path.join(staticDir, "index.html");
                is404 = true;
            }
        }

        // Check if file exists (should always exist now since we fallback to index.html)
        if (!fs.existsSync(filePath)) {
            // This should rarely happen - only if index.html itself is missing
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("Not found");
            return;
        }

        // Determine content type
        const ext = path.extname(filePath);
        const contentTypes: Record<string, string> = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".eot": "application/vnd.ms-fontobject",
        };
        const contentType = contentTypes[ext] || "application/octet-stream";

        try {
            const content = fs.readFileSync(filePath);

            // Set status code to 404 if serving the 404 page
            const statusCode = is404 ? 404 : 200;
            res.writeHead(statusCode, { "Content-Type": contentType });
            res.end(content);
        } catch (error) {
            log("error", "Error serving file:", error);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
        }
    });

    // Setup WebSocket server for RPC
    const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: compressionConfig.enabled
            ? {
                  zlibDeflateOptions: {
                      chunkSize: 1024,
                      memLevel: 7,
                      level: 3, // Lower = faster, higher = better compression (1-9)
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
        registry.setSocketMetadata(socket, ip, req);

        // Track connection and check IP limit
        if (!rateLimiter.trackConnection(socket, ip)) {
            socket.close(1008, "Too many connections from your IP");
            return;
        }

        socket.on("message", (msg: WebSocket.RawData) => {
            // Check rate limit
            if (!rateLimiter.checkRateLimit(socket)) {
                // Parse request to get the ID for proper error response
                try {
                    let req: any;
                    if (Buffer.isBuffer(msg)) {
                        const { decode: msgpackDecode } = require("@msgpack/msgpack");
                        req = msgpackDecode(msg);
                    } else {
                        req = JSON.parse(msg.toString());
                    }

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
                    log("warn", `Rate limit exceeded for IP ${ip}, resets in ${resetInSeconds} seconds`);
                    if (rpcConfig.encoding === "msgpack") {
                        socket.send(msgpackEncode(errorResponse) as Buffer);
                    } else {
                        socket.send(JSON.stringify(errorResponse));
                    }
                } catch {
                    // If we can't parse the request, just close the connection
                    socket.close();
                }
                return;
            }

            registry.handleMessage(socket, Buffer.isBuffer(msg) ? msg : msg.toString());
        });
    });

    // Handle WebSocket upgrade requests
    server.on("upgrade", (req, socket, head) => {
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
            const ip = extractClientIP(req, trustProxyDepth);
            if (rpcSecurity.maxConnectionsPerIP > 0) {
                const currentConnections = rateLimiter.getIPConnectionCount(ip);
                if (currentConnections >= rpcSecurity.maxConnectionsPerIP) {
                    log("warn", `WebSocket connection rejected - IP ${ip} has ${currentConnections} connections`);
                    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
                    socket.destroy();
                    return;
                }
            }

            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit("connection", ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    // Start server
    server.listen(port, () => {
        log("info", `Production server listening on http://localhost:${port}`);
        log("info", `Serving static files from ${staticDir}`);
        log("info", `WebSocket RPC available at ws://localhost:${port}/rpc`);
    });

    return server;
}
