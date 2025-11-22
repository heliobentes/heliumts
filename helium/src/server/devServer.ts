import type http from 'http';
import type http2 from 'http2';
import type https from 'https';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

import { injectEnvToProcess, loadEnvFiles } from "../utils/envLoader.js";
import { HTTPRouter } from './httpRouter.js';
import { RpcRegistry } from './rpcRegistry.js';

type LoadHandlersFn = (registry: RpcRegistry, httpRouter: HTTPRouter) => void;
type HttpServer = http.Server | https.Server | http2.Http2Server | http2.Http2SecureServer;

let currentRegistry: RpcRegistry | null = null;
let currentHttpRouter: HTTPRouter | null = null;
let wss: WebSocketServer | null = null;

/**
 * Attaches HeliumJS HTTP handlers and WebSocket RPC server to an existing HTTP server.
 * This is used in dev mode to attach to Vite's dev server.
 */
export function attachToDevServer(httpServer: HttpServer, loadHandlers: LoadHandlersFn) {
    // Load environment variables for server-side access
    const envVars = loadEnvFiles();
    injectEnvToProcess(envVars);

    const registry = new RpcRegistry();
    const httpRouter = new HTTPRouter();
    loadHandlers(registry, httpRouter);
    currentRegistry = registry;
    currentHttpRouter = httpRouter;

    // Attach WebSocket server if not already attached
    if (!wss) {
        wss = new WebSocketServer({ noServer: true });

        wss.on("connection", (socket: WebSocket) => {
            socket.on("message", (msg: WebSocket.RawData) => {
                // Always use the current registry (may have been updated)
                if (currentRegistry) {
                    currentRegistry.handleMessage(socket, msg.toString());
                }
            });
        });

        // Handle WebSocket upgrade requests
        httpServer.on("upgrade", (req, socket, head) => {
            if (req.url === "/rpc") {
                wss!.handleUpgrade(req, socket, head, (ws) => {
                    wss!.emit("connection", ws, req);
                });
            }
        });

        console.log("[Helium] ➜ WebSocket RPC attached to dev server at /rpc");
    }

    // Attach HTTP request handler
    // We need to intercept requests before Vite handles them
    const originalListeners = httpServer.listeners("request").slice();
    httpServer.removeAllListeners("request");

    httpServer.on("request", async (req: any, res: any) => {
        // Try HTTP handlers first
        if (currentHttpRouter) {
            const handled = await currentHttpRouter.handleRequest(req, res);
            if (handled) return;
        }

        // If no handler matched, pass to original Vite handlers
        for (const listener of originalListeners) {
            (listener as any)(req, res);
        }
    });
}
