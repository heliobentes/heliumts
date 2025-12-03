import type http from "http";
import { describe, expect, it, vi } from "vitest";

import { extractClientIP, extractClientIPFromRight } from "../../src/utils/ipExtractor";

function createMockRequest(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): http.IncomingMessage {
    return {
        headers,
        socket: {
            remoteAddress: remoteAddress ?? "127.0.0.1",
        },
    } as unknown as http.IncomingMessage;
}

describe("ipExtractor", () => {
    describe("extractClientIP", () => {
        it("should return socket remoteAddress when trustProxyDepth is 0", () => {
            const req = createMockRequest(
                {
                    "x-forwarded-for": "203.0.113.1, 198.51.100.1",
                    "cf-connecting-ip": "203.0.113.50",
                },
                "192.168.1.1"
            );

            const ip = extractClientIP(req, 0);

            expect(ip).toBe("192.168.1.1");
        });

        it("should return 'unknown' when no remoteAddress and trustProxyDepth is 0", () => {
            const req = createMockRequest({}, undefined);
            (req.socket as { remoteAddress: string | undefined }).remoteAddress = undefined;

            const ip = extractClientIP(req, 0);

            expect(ip).toBe("unknown");
        });

        it("should prioritize cf-connecting-ip header when trustProxyDepth > 0", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "203.0.113.50",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
                "x-real-ip": "203.0.113.25",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.50");
        });

        it("should use true-client-ip when cf-connecting-ip is not present", () => {
            const req = createMockRequest({
                "true-client-ip": "203.0.113.75",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.75");
        });

        it("should use x-real-ip when other headers are not present", () => {
            const req = createMockRequest({
                "x-real-ip": "203.0.113.25",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.25");
        });

        it("should extract first IP from x-forwarded-for when other headers not present", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.1");
        });

        it("should handle x-forwarded-for as array", () => {
            const req = createMockRequest({
                "x-forwarded-for": ["203.0.113.1", "198.51.100.1"],
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.1");
        });

        it("should trim whitespace from IP addresses", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "  203.0.113.50  ",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.50");
        });

        it("should skip empty header values", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "   ",
                "x-real-ip": "203.0.113.25",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.25");
        });

        it("should return socket IP when x-forwarded-for chain is shorter than trust depth", () => {
            const req = createMockRequest(
                {
                    "x-forwarded-for": "203.0.113.1",
                },
                "192.168.1.1"
            );

            // Trust depth 2 but only 1 IP in chain
            const ip = extractClientIP(req, 2);

            // Should fallback to socket since chain is too short
            expect(ip).toBe("192.168.1.1");
        });
    });

    describe("extractClientIPFromRight", () => {
        it("should return socket remoteAddress when trustProxyDepth is 0", () => {
            const req = createMockRequest(
                {
                    "x-forwarded-for": "203.0.113.1, 198.51.100.1",
                },
                "192.168.1.1"
            );

            const ip = extractClientIPFromRight(req, 0);

            expect(ip).toBe("192.168.1.1");
        });

        it("should still prioritize single-value headers", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "203.0.113.50",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
            });

            const ip = extractClientIPFromRight(req, 1);

            expect(ip).toBe("203.0.113.50");
        });

        it("should extract IP from right side of x-forwarded-for chain", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            // trustProxyDepth=1: skip last 1 proxy, return index length-1-1 = 1
            const ip = extractClientIPFromRight(req, 1);

            expect(ip).toBe("198.51.100.1");
        });

        it("should return first IP when trustProxyDepth equals chain length", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            // trustProxyDepth=2: skip last 2 proxies, return the client
            const ip = extractClientIPFromRight(req, 2);

            expect(ip).toBe("203.0.113.1");
        });
    });
});
