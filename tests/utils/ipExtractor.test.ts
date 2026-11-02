import type http from "http";
import { describe, expect, it } from "vitest";

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

        it("should prioritize x-forwarded-for over single-value headers when trustProxyDepth > 0", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "203.0.113.50",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
                "x-real-ip": "203.0.113.25",
            });

            const ip = extractClientIP(req, 1);

            // Ignore an untrusted prefix prepended before the trusted proxy appends the client IP.
            expect(ip).toBe("198.51.100.1");
        });

        it("should fall back to cf-connecting-ip when x-forwarded-for is not present", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "203.0.113.50",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.50");
        });

        it("should use true-client-ip when cf-connecting-ip and x-forwarded-for are not present", () => {
            const req = createMockRequest({
                "true-client-ip": "203.0.113.75",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.75");
        });

        it("should use x-real-ip when other headers are not present", () => {
            const req = createMockRequest({
                "x-real-ip": "203.0.113.25",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("203.0.113.25");
        });

        it("should select the rightmost forwarded IP for one trusted proxy", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("192.0.2.1");
        });

        it("should handle x-forwarded-for as array", () => {
            const req = createMockRequest({
                "x-forwarded-for": ["203.0.113.1", "198.51.100.1"],
            });

            const ip = extractClientIP(req, 1);

            expect(ip).toBe("198.51.100.1");
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

        it("should prioritize the trusted forwarded chain over provider headers", () => {
            const req = createMockRequest({
                "cf-connecting-ip": "203.0.113.50",
                "x-forwarded-for": "203.0.113.1, 198.51.100.1",
            });

            const ip = extractClientIPFromRight(req, 1);

            expect(ip).toBe("198.51.100.1");
        });

        it("should extract IP from right side of x-forwarded-for chain", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            // The direct socket is the one trusted proxy.
            const ip = extractClientIPFromRight(req, 1);

            expect(ip).toBe("192.0.2.1");
        });

        it("should move left by the number of additional trusted proxies", () => {
            const req = createMockRequest({
                "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
            });

            // The direct socket and the rightmost forwarded entry are trusted.
            const ip = extractClientIPFromRight(req, 2);

            expect(ip).toBe("198.51.100.1");
        });
    });
});

describe("proxy trust boundaries", () => {
    it("ignores arbitrary spoofed prefixes", () => {
        for (const spoof of ["1.1.1.1", "1.1.1.1, 2.2.2.2", "malformed"]) {
            expect(extractClientIP(createMockRequest({ "x-forwarded-for": `${spoof}, 203.0.113.8` }), 1)).toBe("203.0.113.8");
        }
    });
    it("supports multiple proxies counting the direct socket", () => {
        const req = createMockRequest({ "x-forwarded-for": "1.1.1.1, 203.0.113.8, 10.0.0.1" });
        expect(extractClientIP(req, 2)).toBe("203.0.113.8");
        expect(extractClientIP(req, 3)).toBe("1.1.1.1");
    });
    it("rejects invalid depths and malformed addresses", () => {
        const req = createMockRequest({ "x-forwarded-for": "bad", "cf-connecting-ip": "1.1.1.1" });
        for (const depth of [-1, 0.5, NaN, Infinity, 1, 2]) {
            expect(extractClientIP(req, depth)).toBe("127.0.0.1");
        }
    });
});
