import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";

import { RateLimiter } from "../../src/server/rateLimiter";

// Create a mock WebSocket
function createMockSocket(): WebSocket {
    const listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

    return {
        on: vi.fn((event: string, callback: () => void) => {
            if (!listeners.has(event)) {
                listeners.set(event, []);
            }
            listeners.get(event)!.push(callback);
        }),
        emit: vi.fn((event: string) => {
            const eventListeners = listeners.get(event);
            if (eventListeners) {
                eventListeners.forEach((cb) => cb());
            }
        }),
        close: vi.fn(),
    } as unknown as WebSocket;
}

describe("RateLimiter", () => {
    let rateLimiter: RateLimiter;

    beforeEach(() => {
        // 10 messages per 1000ms, max 2 connections per IP
        rateLimiter = new RateLimiter(10, 1000, 2);
    });

    describe("trackConnection", () => {
        it("should track a new connection", () => {
            const socket = createMockSocket();

            const result = rateLimiter.trackConnection(socket, "192.168.1.1");

            expect(result).toBe(true);
            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(1);
        });

        it("should allow multiple connections from same IP up to limit", () => {
            const socket1 = createMockSocket();
            const socket2 = createMockSocket();

            expect(rateLimiter.trackConnection(socket1, "192.168.1.1")).toBe(true);
            expect(rateLimiter.trackConnection(socket2, "192.168.1.1")).toBe(true);
            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(2);
        });

        it("should reject connection when IP limit exceeded", () => {
            const socket1 = createMockSocket();
            const socket2 = createMockSocket();
            const socket3 = createMockSocket();

            rateLimiter.trackConnection(socket1, "192.168.1.1");
            rateLimiter.trackConnection(socket2, "192.168.1.1");
            const result = rateLimiter.trackConnection(socket3, "192.168.1.1");

            expect(result).toBe(false);
            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(2);
        });

        it("should track connections from different IPs independently", () => {
            const socket1 = createMockSocket();
            const socket2 = createMockSocket();

            rateLimiter.trackConnection(socket1, "192.168.1.1");
            rateLimiter.trackConnection(socket2, "192.168.1.2");

            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(1);
            expect(rateLimiter.getIPConnectionCount("192.168.1.2")).toBe(1);
        });

        it("should set up close listener on socket", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            expect(socket.on).toHaveBeenCalledWith("close", expect.any(Function));
        });
    });

    describe("untrackConnection", () => {
        it("should remove connection from tracking", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            rateLimiter.untrackConnection(socket);

            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(0);
        });

        it("should cleanup IP set when last connection removed", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");
            rateLimiter.untrackConnection(socket);

            // After cleanup, a new connection should work
            const newSocket = createMockSocket();
            expect(rateLimiter.trackConnection(newSocket, "192.168.1.1")).toBe(true);
        });

        it("should handle untracking non-tracked socket gracefully", () => {
            const socket = createMockSocket();

            // Should not throw
            expect(() => rateLimiter.untrackConnection(socket)).not.toThrow();
        });
    });

    describe("checkRateLimit", () => {
        it("should allow messages within rate limit", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            for (let i = 0; i < 10; i++) {
                expect(rateLimiter.checkRateLimit(socket)).toBe(true);
            }
        });

        it("should block messages exceeding rate limit", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            // Use up all allowed messages
            for (let i = 0; i < 10; i++) {
                rateLimiter.checkRateLimit(socket);
            }

            // 11th message should be blocked
            expect(rateLimiter.checkRateLimit(socket)).toBe(false);
        });

        it("should reset rate limit after window expires", async () => {
            vi.useFakeTimers();

            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            // Use up all messages
            for (let i = 0; i < 10; i++) {
                rateLimiter.checkRateLimit(socket);
            }
            expect(rateLimiter.checkRateLimit(socket)).toBe(false);

            // Advance time past the window
            vi.advanceTimersByTime(1001);

            // Should be allowed again
            expect(rateLimiter.checkRateLimit(socket)).toBe(true);

            vi.useRealTimers();
        });

        it("should return false for untracked socket", () => {
            const socket = createMockSocket();

            expect(rateLimiter.checkRateLimit(socket)).toBe(false);
        });

        it("should return true when rate limiting is disabled (maxMessages = 0)", () => {
            const unlimitedRateLimiter = new RateLimiter(0, 1000, 10);
            const socket = createMockSocket();
            unlimitedRateLimiter.trackConnection(socket, "192.168.1.1");

            // Should always return true when disabled
            for (let i = 0; i < 100; i++) {
                expect(unlimitedRateLimiter.checkRateLimit(socket)).toBe(true);
            }
        });
    });

    describe("getConnectionStats", () => {
        it("should return current stats for tracked connection", () => {
            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            // Send 5 messages
            for (let i = 0; i < 5; i++) {
                rateLimiter.checkRateLimit(socket);
            }

            const stats = rateLimiter.getConnectionStats(socket);

            expect(stats).not.toBeNull();
            expect(stats!.messageCount).toBe(5);
            expect(stats!.remainingMessages).toBe(5);
        });

        it("should return null for untracked socket", () => {
            const socket = createMockSocket();

            const stats = rateLimiter.getConnectionStats(socket);

            expect(stats).toBeNull();
        });

        it("should reset stats when window expires", () => {
            vi.useFakeTimers();

            const socket = createMockSocket();
            rateLimiter.trackConnection(socket, "192.168.1.1");

            // Send some messages
            for (let i = 0; i < 5; i++) {
                rateLimiter.checkRateLimit(socket);
            }

            // Advance past window
            vi.advanceTimersByTime(1001);

            const stats = rateLimiter.getConnectionStats(socket);

            expect(stats!.messageCount).toBe(0);
            expect(stats!.remainingMessages).toBe(10);

            vi.useRealTimers();
        });
    });

    describe("getIPConnectionCount", () => {
        it("should return 0 for unknown IP", () => {
            expect(rateLimiter.getIPConnectionCount("unknown.ip")).toBe(0);
        });

        it("should return correct count for tracked IP", () => {
            const socket1 = createMockSocket();
            const socket2 = createMockSocket();

            rateLimiter.trackConnection(socket1, "192.168.1.1");
            rateLimiter.trackConnection(socket2, "192.168.1.1");

            expect(rateLimiter.getIPConnectionCount("192.168.1.1")).toBe(2);
        });
    });

    describe("connection limits disabled", () => {
        it("should allow unlimited connections when maxConnectionsPerIP is 0", () => {
            const unlimitedConnections = new RateLimiter(10, 1000, 0);

            for (let i = 0; i < 100; i++) {
                const socket = createMockSocket();
                expect(unlimitedConnections.trackConnection(socket, "192.168.1.1")).toBe(true);
            }
        });
    });
});
