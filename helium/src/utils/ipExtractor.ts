import type http from "http";

/**
 * Extracts the client IP address from an HTTP request, checking multiple headers
 * and taking into account proxy configurations.
 *
 * Checks headers in order of reliability:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. True-Client-IP (Cloudflare Enterprise, Akamai)
 * 3. X-Real-IP (Nginx, other proxies)
 * 4. X-Forwarded-For (Standard, but can be spoofed)
 * 5. req.socket.remoteAddress (Direct connection)
 *
 * When behind proxies, the X-Forwarded-For header contains a chain of IP addresses.
 * Format: "client, proxy1, proxy2, ..."
 *
 * @param req - The HTTP request object
 * @param trustProxyDepth - Number of proxy levels to trust
 *   - 0: Only use req.socket.remoteAddress (no proxy trust)
 *   - 1: Trust 1 proxy level (recommended for Vercel, Netlify, Railway)
 *   - 2+: Trust multiple proxy levels (for complex setups)
 *
 * Examples:
 * - trustProxyDepth=0: Direct connection, no proxies
 *   All proxy headers ignored
 *   Result: req.socket.remoteAddress
 *
 * - trustProxyDepth=1: Behind one proxy (e.g., Vercel, Netlify)
 *   X-Forwarded-For: "203.0.113.1, 198.51.100.1"
 *   Result: "203.0.113.1" (client IP)
 *
 * - trustProxyDepth=2: Behind two proxies (e.g., Cloudflare -> Load Balancer)
 *   X-Forwarded-For: "203.0.113.1, 198.51.100.1, 192.0.2.1"
 *   Result: "203.0.113.1" (client IP)
 *
 * Common configurations:
 * - Vercel/Netlify/Railway: trustProxyDepth=1
 * - Cloudflare -> Origin: trustProxyDepth=1 (use CF-Connecting-IP)
 * - AWS ALB -> EC2: trustProxyDepth=1
 * - Nginx -> Node: trustProxyDepth=1 (use X-Real-IP)
 * - Cloudflare -> Nginx -> Node: trustProxyDepth=2
 */
export function extractClientIP(req: http.IncomingMessage, trustProxyDepth: number = 0): string {
    // If not trusting any proxies, return the direct connection IP
    if (trustProxyDepth === 0) {
        return req.socket.remoteAddress || "unknown";
    }

    // 1. Check CF-Connecting-IP (Cloudflare's guaranteed client IP)
    const cfConnectingIP = req.headers["cf-connecting-ip"];
    if (cfConnectingIP && typeof cfConnectingIP === "string" && cfConnectingIP.trim().length > 0) {
        return cfConnectingIP.trim();
    }

    // 2. Check True-Client-IP (Cloudflare Enterprise, Akamai)
    const trueClientIP = req.headers["true-client-ip"];
    if (trueClientIP && typeof trueClientIP === "string" && trueClientIP.trim().length > 0) {
        return trueClientIP.trim();
    }

    // 3. Check X-Real-IP (Nginx, other proxies)
    const xRealIP = req.headers["x-real-ip"];
    if (xRealIP && typeof xRealIP === "string" && xRealIP.trim().length > 0) {
        return xRealIP.trim();
    }

    // 4. Check X-Forwarded-For (Standard, but requires parsing)
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
        const forwardedIPs = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor)
            .split(",")
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0);

        if (forwardedIPs.length > 0) {
            // Verify we have enough IPs in the chain for the trust depth
            if (forwardedIPs.length >= trustProxyDepth) {
                // Return the client IP (first in the chain)
                return forwardedIPs[0];
            }
        }
    }

    // 5. Fall back to direct connection
    return req.socket.remoteAddress || "unknown";
}

/**
 * Alternative extraction method that works from the right (trusts the rightmost IPs).
 * This is useful when you want to trust the last N proxies in the chain.
 *
 * Note: This only applies to X-Forwarded-For parsing. Single-value headers like
 * CF-Connecting-IP are still checked first.
 *
 * @param req - The HTTP request object
 * @param trustProxyDepth - Number of proxy levels to trust from the right
 *
 * Example:
 * X-Forwarded-For: "203.0.113.1, 198.51.100.1, 192.0.2.1"
 * trustProxyDepth=1: Result is "198.51.100.1" (skip the last trusted proxy)
 * trustProxyDepth=2: Result is "203.0.113.1" (skip the last 2 trusted proxies)
 */
export function extractClientIPFromRight(req: http.IncomingMessage, trustProxyDepth: number = 0): string {
    if (trustProxyDepth === 0) {
        return req.socket.remoteAddress || "unknown";
    }

    // Check single-value headers first (same as extractClientIP)
    const cfConnectingIP = req.headers["cf-connecting-ip"];
    if (cfConnectingIP && typeof cfConnectingIP === "string" && cfConnectingIP.trim().length > 0) {
        return cfConnectingIP.trim();
    }

    const trueClientIP = req.headers["true-client-ip"];
    if (trueClientIP && typeof trueClientIP === "string" && trueClientIP.trim().length > 0) {
        return trueClientIP.trim();
    }

    const xRealIP = req.headers["x-real-ip"];
    if (xRealIP && typeof xRealIP === "string" && xRealIP.trim().length > 0) {
        return xRealIP.trim();
    }

    // For X-Forwarded-For, use right-based extraction
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
        const forwardedIPs = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor)
            .split(",")
            .map((ip) => ip.trim())
            .filter((ip) => ip.length > 0);

        if (forwardedIPs.length > 0) {
            // Calculate which IP to trust by skipping the rightmost N trusted proxies
            const clientIPIndex = Math.max(0, forwardedIPs.length - trustProxyDepth - 1);
            return forwardedIPs[clientIPIndex];
        }
    }

    return req.socket.remoteAddress || "unknown";
}
