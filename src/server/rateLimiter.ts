/** Share a fixed request window per client IP across unary and streaming RPC. */
export class RateLimiter {
    private httpRequests = new Map<string, { requestCount: number; windowStart: number }>();
    private lastCleanup = 0;

    constructor(
        private maxRequestsPerWindow: number,
        private rateLimitWindowMs: number
    ) {}

    configure(maxRequestsPerWindow: number, rateLimitWindowMs: number): void {
        this.maxRequestsPerWindow = maxRequestsPerWindow;
        this.rateLimitWindowMs = rateLimitWindowMs;
    }

    checkHttpRateLimit(ip: string): boolean {
        if (this.maxRequestsPerWindow === 0) {
            return true;
        }
        const now = Date.now();
        if (now - this.lastCleanup >= this.rateLimitWindowMs) {
            for (const [key, info] of this.httpRequests) {
                if (now - info.windowStart >= this.rateLimitWindowMs) {
                    this.httpRequests.delete(key);
                }
            }
            this.lastCleanup = now;
        }
        let info = this.httpRequests.get(ip);
        if (!info || now - info.windowStart >= this.rateLimitWindowMs) {
            info = { requestCount: 0, windowStart: now };
            this.httpRequests.set(ip, info);
        }
        if (info.requestCount >= this.maxRequestsPerWindow) {
            return false;
        }
        info.requestCount++;
        return true;
    }

    getHttpStats(ip: string): { remainingRequests: number; resetInSeconds: number } {
        if (this.maxRequestsPerWindow === 0) {
            return { remainingRequests: Infinity, resetInSeconds: 0 };
        }
        const info = this.httpRequests.get(ip);
        const now = Date.now();
        if (!info || now - info.windowStart >= this.rateLimitWindowMs) {
            return { remainingRequests: this.maxRequestsPerWindow, resetInSeconds: 0 };
        }
        return {
            remainingRequests: Math.max(0, this.maxRequestsPerWindow - info.requestCount),
            resetInSeconds: Math.max(0, Math.ceil((info.windowStart + this.rateLimitWindowMs - now) / 1000)),
        };
    }
}
