import fs from 'fs';
import http from 'http';
import path from 'path';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { HTTPRouter } from './httpRouter.js';
import { RpcRegistry } from './rpcRegistry.js';

interface ProdServerOptions {
    port?: number;
    distDir?: string;
    staticDir?: string;
    registerHandlers: (registry: RpcRegistry, httpRouter: HTTPRouter) => void;
}

/**
 * Starts a production HTTP server that:
 * - Serves static files from the dist directory
 * - Handles custom HTTP endpoints (webhooks, auth, etc.)
 * - Hosts WebSocket RPC server
 */
export function startProdServer(options: ProdServerOptions) {
    const { port = Number(process.env.PORT || 3000), distDir = "dist", staticDir = path.resolve(process.cwd(), distDir), registerHandlers } = options;

    // Load environment variables for server-side access
    const envVars = loadEnvFiles({ mode: "production" });
    injectEnvToProcess(envVars);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter();
    registerHandlers(registry, httpRouter);

    // Create HTTP server
    const server = http.createServer(async (req, res) => {
        // Try HTTP handlers first (webhooks, auth, etc.)
        const handled = await httpRouter.handleRequest(req, res);
        if (handled) return;

        // Serve static files
        const url = req.url || "/";
        let filePath = path.join(staticDir, url === "/" ? "index.html" : url);

        // If file doesn't exist and it's not an API route, serve index.html (SPA fallback)
        if (!fs.existsSync(filePath)) {
            // Only fallback to index.html for non-API routes
            if (!url.startsWith("/api") && !url.startsWith("/webhooks") && !url.startsWith("/auth")) {
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
            const content = fs.readFileSync(filePath);
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
        } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
        }
    });

    // Setup WebSocket server for RPC
    const wss = new WebSocketServer({ noServer: true });

    wss.on("connection", (socket: WebSocket) => {
        socket.on("message", (msg: WebSocket.RawData) => {
            registry.handleMessage(socket, msg.toString());
        });
    });

    // Handle WebSocket upgrade requests
    server.on("upgrade", (req, socket, head) => {
        if (req.url === "/rpc") {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit("connection", ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    // Start server
    server.listen(port, () => {
        console.log(`[Helium] ➜ Production server listening on http://localhost:${port}`);
        console.log(`[Helium] ➜ Serving static files from ${staticDir}`);
        console.log(`[Helium] ➜ WebSocket RPC available at ws://localhost:${port}/rpc`);
    });

    return server;
}
