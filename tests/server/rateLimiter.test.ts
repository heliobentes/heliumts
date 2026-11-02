import { afterEach, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/server/rateLimiter";
afterEach(() => vi.useRealTimers());
it("shares a fixed window per IP without affecting other clients", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.checkHttpRateLimit("a")).toBe(true);
    expect(limiter.checkHttpRateLimit("a")).toBe(true);
    expect(limiter.checkHttpRateLimit("a")).toBe(false);
    expect(limiter.checkHttpRateLimit("b")).toBe(true);
    expect(limiter.getHttpStats("a")).toMatchObject({ remainingRequests: 0 });
});
it("resets expired windows and supports disabled limits", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 1000);
    limiter.checkHttpRateLimit("a");
    expect(limiter.checkHttpRateLimit("a")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(limiter.checkHttpRateLimit("a")).toBe(true);
    limiter.configure(0, 1000);
    expect(limiter.checkHttpRateLimit("a")).toBe(true);
    expect(limiter.getHttpStats("a")).toEqual({ remainingRequests: Infinity, resetInSeconds: 0 });
});
it("retains used requests when configuration changes within a window", () => {
    const limiter = new RateLimiter(3, 1000);
    limiter.checkHttpRateLimit("a");
    limiter.configure(1, 1000);
    expect(limiter.checkHttpRateLimit("a")).toBe(false);
});
