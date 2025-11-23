import fs from "fs";
import http from "http";
import path from "path";
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

    // Load environment variables for server-side access
    const envVars = loadEnvFiles({ mode: "production" });
    injectEnvToProcess(envVars);

    // Initialize security with config
    const securityConfig = getSecurityConfig(config);
    initializeSecurity(securityConfig);

    // Initialize rate limiter
    const rateLimiter = new RateLimiter(securityConfig.maxMessagesPerWindow, securityConfig.rateLimitWindowMs, securityConfig.maxConnectionsPerIP);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter();
    httpRouter.setTrustProxyDepth(securityConfig.trustProxyDepth);
    registerHandlers(registry, httpRouter);
    registry.setRateLimiter(rateLimiter);

    // Create HTTP server
    const server = http.createServer(async (req, res) => {
        // Try HTTP handlers first (webhooks, auth, etc.)
        const handled = await httpRouter.handleRequest(req, res);
        if (handled) {
            return;
        }

        // Serve static files
        const url = req.url || "/";
        let filePath = path.join(staticDir, url === "/" ? "index.html" : url);

        // If file doesn't exist, try SSG HTML file (e.g., /contact -> contact.html)
        if (!fs.existsSync(filePath) && !url.startsWith("/api") && !url.startsWith("/webhooks") && !url.startsWith("/auth")) {
            // Remove leading slash and query params
            const cleanPath = url.split("?")[0].replace(/^\//, "");
            
            // Try SSG HTML file
            const ssgPath = path.join(staticDir, `${cleanPath}.html`);
            if (fs.existsSync(ssgPath)) {
                filePath = ssgPath;
            } else {
                // Fall back to index.html for SPA routing
                filePath = path.join(staticDir, "index.html");
            }
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
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
            let content = fs.readFileSync(filePath);

            // Inject connection token into HTML files
            if (contentType === "text/html") {
                const token = generateConnectionToken();
                const html = content.toString("utf-8");
                // Replace build-time placeholder or inject before </head>
                let injected: string;
                if (html.includes("build-time-placeholder")) {
                    // Replace the placeholder (for SSG pages)
                    injected = html.replace('"build-time-placeholder"', `"${token}"`);
                } else {
                    // Inject before </head> (for regular SPA)
                    injected = html.replace("</head>", `<script>window.HELIUM_CONNECTION_TOKEN = "${token}";</script></head>`);
                }
                content = Buffer.from(injected);
            }

            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
        } catch {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
        }
    });

    // Setup WebSocket server for RPC
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket: WebSocket, req: http.IncomingMessage) => {
        // Extract client IP with proxy configuration
        const ip = extractClientIP(req, securityConfig.trustProxyDepth);

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
                    log("warn", `Rate limit exceeded for IP ${ip}, resets in ${resetInSeconds} seconds`);
                    socket.send(JSON.stringify(errorResponse));
                } catch {
                    // If we can't parse the request, just close the connection
                    socket.close();
                }
                return;
            }

            registry.handleMessage(socket, msg.toString());
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
            const ip = extractClientIP(req, securityConfig.trustProxyDepth);
            if (securityConfig.maxConnectionsPerIP > 0) {
                const currentConnections = rateLimiter.getIPConnectionCount(ip);
                if (currentConnections >= securityConfig.maxConnectionsPerIP) {
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
