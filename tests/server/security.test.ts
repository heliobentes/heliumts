import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateConnectionToken, initializeSecurity, resetSecurity, verifyConnectionToken } from "../../src/server/security";

describe("security", () => {
    const originalEnv = process.env.HELIUM_SECRET;

    beforeEach(() => {
        // Reset security module state for fresh initialization
        resetSecurity();

        // Reset environment
        delete process.env.HELIUM_SECRET;

        // Suppress console output during tests
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.HELIUM_SECRET = originalEnv;
        } else {
            delete process.env.HELIUM_SECRET;
        }
        vi.restoreAllMocks();
    });

    describe("initializeSecurity", () => {
        it("should initialize with default config", () => {
            const config = {
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            };

            // Should not throw
            expect(() => initializeSecurity(config)).not.toThrow();
        });

        it("should use HELIUM_SECRET from environment if set", () => {
            process.env.HELIUM_SECRET = "test-secret-key";

            const config = {
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            };

            initializeSecurity(config);

            // Generate a token to verify the secret is being used
            const token = generateConnectionToken();
            expect(token).toBeTruthy();
        });

        it("should generate random secret if HELIUM_SECRET not set", () => {
            const config = {
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            };

            initializeSecurity(config);

            const token = generateConnectionToken();
            expect(token).toBeTruthy();
        });
    });

    describe("generateConnectionToken", () => {
        beforeEach(() => {
            initializeSecurity({
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            });
        });

        it("should generate a token with timestamp and signature", () => {
            const token = generateConnectionToken();

            expect(token).toMatch(/^\d+\.[a-f0-9]+$/);
        });

        it("should generate different tokens at different times", () => {
            vi.useFakeTimers();

            const token1 = generateConnectionToken();
            vi.advanceTimersByTime(100);
            const token2 = generateConnectionToken();

            expect(token1).not.toBe(token2);

            vi.useRealTimers();
        });

        it("should include current timestamp", () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);

            const token = generateConnectionToken();
            const [timestamp] = token.split(".");

            expect(parseInt(timestamp, 10)).toBe(now);

            vi.useRealTimers();
        });
    });

    describe("verifyConnectionToken", () => {
        beforeEach(() => {
            initializeSecurity({
                maxConnectionsPerIP: 10,
                maxMessagesPerWindow: 100,
                rateLimitWindowMs: 60000,
                tokenValidityMs: 30000,
            });
        });

        it("should verify a valid token", () => {
            const token = generateConnectionToken();

            expect(verifyConnectionToken(token)).toBe(true);
        });

        it("should reject empty token", () => {
            expect(verifyConnectionToken("")).toBe(false);
        });

        it("should reject token without signature", () => {
            expect(verifyConnectionToken("12345")).toBe(false);
        });

        it("should reject token with invalid format", () => {
            expect(verifyConnectionToken("invalid.format.extra")).toBe(false);
        });

        it("should reject expired token", () => {
            vi.useFakeTimers();

            const token = generateConnectionToken();

            // Advance time past token validity (30 seconds)
            vi.advanceTimersByTime(31000);

            expect(verifyConnectionToken(token)).toBe(false);

            vi.useRealTimers();
        });

        it("should reject token with future timestamp", () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);

            // Create a token with a future timestamp (more than 1 second ahead)
            const futureTimestamp = (now + 5000).toString();
            const hmac = crypto.createHmac("sha256", "test");
            hmac.update(futureTimestamp);
            const signature = hmac.digest("hex");
            const token = `${futureTimestamp}.${signature}`;

            expect(verifyConnectionToken(token)).toBe(false);

            vi.useRealTimers();
        });

        it("should reject token with invalid signature", () => {
            const token = generateConnectionToken();
            const [timestamp] = token.split(".");
            const tamperedToken = `${timestamp}.invalidsignature`;

            expect(verifyConnectionToken(tamperedToken)).toBe(false);
        });

        it("should reject token with modified timestamp", () => {
            const token = generateConnectionToken();
            const [, signature] = token.split(".");
            const modifiedToken = `${Date.now() + 1000}.${signature}`;

            expect(verifyConnectionToken(modifiedToken)).toBe(false);
        });
    });
});
