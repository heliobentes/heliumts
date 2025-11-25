import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";

import type { RpcRequest, RpcResponse, RpcStats } from "../runtime/protocol.js";

export type RpcResult<T> = {
    data: T;
    stats: RpcStats;
};

let socket: WebSocket | null = null;
let connectionPromise: Promise<WebSocket> | null = null;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function uuid() {
    return Math.random().toString(36).slice(2);
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

    ws.onmessage = (event) => {
        let msg: RpcResponse;

        // Handle both binary (MessagePack) and text (JSON) messages.
        if (event.data instanceof ArrayBuffer) {
            msg = msgpackDecode(new Uint8Array(event.data)) as RpcResponse;
        } else {
            try {
                msg = JSON.parse(event.data);
            } catch {
                msg = msgpackDecode(new Uint8Array(event.data)) as RpcResponse;
            }
        }

        const entry = pending.get(msg.id);
        if (!entry) {
            return;
        }
        pending.delete(msg.id);
        if (msg.ok) {
            entry.resolve({ data: msg.result, stats: msg.stats });
        } else {
            entry.reject({ error: msg.error, stats: msg.stats });
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

export async function rpcCall<TResult = unknown, TArgs = unknown>(methodId: string, args?: TArgs): Promise<RpcResult<TResult>> {
    const ws = await ensureSocketReady();
    const id = uuid();

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
