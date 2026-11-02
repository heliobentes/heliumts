import type WebSocket from "ws";

interface ConnectionInfo {
    messageCount: number;
    windowStart: number;
    ip: string;
}

export class RateLimiter {
    private connections = new WeakMap<WebSocket, ConnectionInfo>();
    private ipConnections = new Map<string, Set<WebSocket>>();
    private httpRequests = new Map<string, { messageCount: number; windowStart: number }>();
    private lastHttpCleanup = 0;
    private maxMessagesPerWindow: number;
    private rateLimitWindowMs: number;
    private maxConnectionsPerIP: number;

    constructor(maxMessagesPerWindow: number, rateLimitWindowMs: number, maxConnectionsPerIP: number) {
        this.maxMessagesPerWindow = maxMessagesPerWindow;
        this.rateLimitWindowMs = rateLimitWindowMs;
        this.maxConnectionsPerIP = maxConnectionsPerIP;
    }

    configure(maxMessagesPerWindow: number, rateLimitWindowMs: number, maxConnectionsPerIP: number): void {
        this.maxMessagesPerWindow = maxMessagesPerWindow;
        this.rateLimitWindowMs = rateLimitWindowMs;
        this.maxConnectionsPerIP = maxConnectionsPerIP;
    }

    /**
     * Track a new WebSocket connection.
     * Returns false if the IP has exceeded the connection limit.
     */
    trackConnection(socket: WebSocket, ip: string): boolean {
        // Check if IP has too many connections
        if (this.maxConnectionsPerIP > 0) {
            const connections = this.ipConnections.get(ip);
            if (connections && connections.size >= this.maxConnectionsPerIP) {
                return false;
            }
        }

        // Track the connection
        this.connections.set(socket, {
            messageCount: 0,
            windowStart: Date.now(),
            ip,
        });

        // Add to IP tracking
        if (!this.ipConnections.has(ip)) {
            this.ipConnections.set(ip, new Set());
        }
        this.ipConnections.get(ip)!.add(socket);

        // Clean up when socket closes
        socket.on("close", () => {
            this.untrackConnection(socket);
        });

        return true;
    }

    /**
     * Untrack a connection when it closes.
     */
    untrackConnection(socket: WebSocket): void {
        const info = this.connections.get(socket);
        if (info) {
            const ipSet = this.ipConnections.get(info.ip);
            if (ipSet) {
                ipSet.delete(socket);
                if (ipSet.size === 0) {
                    this.ipConnections.delete(info.ip);
                }
            }
            this.connections.delete(socket);
        }
    }

    /**
     * Check if a message from this connection should be allowed.
     * Returns true if allowed, false if rate limit exceeded.
     */
    checkRateLimit(socket: WebSocket): boolean {
        if (this.maxMessagesPerWindow === 0) {
            return true; // Rate limiting disabled
        }

        const info = this.connections.get(socket);
        if (!info) {
            return false; // Connection not tracked
        }

        const now = Date.now();
        const windowElapsed = now - info.windowStart;

        // Reset window if it has expired
        if (windowElapsed >= this.rateLimitWindowMs) {
            info.messageCount = 1;
            info.windowStart = now;
            return true;
        }

        // Check if limit exceeded
        if (info.messageCount >= this.maxMessagesPerWindow) {
            return false;
        }

        // Increment counter
        info.messageCount++;
        return true;
    }

    /**
     * Get current stats for a connection.
     */
    getConnectionStats(socket: WebSocket): { messageCount: number; remainingMessages: number; resetTimeMs: number } | null {
        const info = this.connections.get(socket);
        if (!info) {
            return null;
        }

        const now = Date.now();
        const windowElapsed = now - info.windowStart;

        // If window expired, stats are reset
        if (windowElapsed >= this.rateLimitWindowMs) {
            return {
                messageCount: 0,
                remainingMessages: this.maxMessagesPerWindow,
                resetTimeMs: now + this.rateLimitWindowMs,
            };
        }

        return {
            messageCount: info.messageCount,
            remainingMessages: Math.max(0, this.maxMessagesPerWindow - info.messageCount),
            resetTimeMs: info.windowStart + this.rateLimitWindowMs,
        };
    }

    /**
     * Get the number of connections from a specific IP.
     */
    getIPConnectionCount(ip: string): number {
        return this.ipConnections.get(ip)?.size ?? 0;
    }

    /** HTTP requests have no persistent socket, so share a window per client IP. */
    checkHttpRateLimit(ip: string): boolean {
        if (this.maxMessagesPerWindow === 0) {
            return true;
        }
        const now = Date.now();
        if (now - this.lastHttpCleanup >= this.rateLimitWindowMs) {
            for (const [key, info] of this.httpRequests) {
                if (now - info.windowStart >= this.rateLimitWindowMs) {
                    this.httpRequests.delete(key);
                }
            }
            this.lastHttpCleanup = now;
        }
        let info = this.httpRequests.get(ip);
        if (!info || now - info.windowStart >= this.rateLimitWindowMs) {
            info = { messageCount: 0, windowStart: now };
            this.httpRequests.set(ip, info);
        }
        if (info.messageCount >= this.maxMessagesPerWindow) {
            return false;
        }
        info.messageCount++;
        return true;
    }

    getHttpStats(ip: string): { remainingRequests: number; resetInSeconds: number } {
        const info = this.httpRequests.get(ip);
        const now = Date.now();
        if (this.maxMessagesPerWindow === 0) {
            return { remainingRequests: Infinity, resetInSeconds: 0 };
        }
        if (!info || now - info.windowStart >= this.rateLimitWindowMs) {
            return { remainingRequests: this.maxMessagesPerWindow, resetInSeconds: 0 };
        }
        return {
            remainingRequests: Math.max(0, this.maxMessagesPerWindow - info.messageCount),
            resetInSeconds: Math.max(0, Math.ceil((info.windowStart + this.rateLimitWindowMs - now) / 1000)),
        };
    }
}
