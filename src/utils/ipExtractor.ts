import type http from "http";
import { isIP } from "net";

/**
 * Extract the client IP by trusting exactly `trustProxyDepth` hops, including
 * the direct peer. For one trusted proxy, use the rightmost X-Forwarded-For
 * entry; for two, use the next entry to its left. Untrusted prefixes are ignored.
 *
 * With no forwarded chain, provider-specific headers are accepted only when
 * proxy trust is enabled. The trusted proxy must overwrite those headers.
 */
export function extractClientIP(req: http.IncomingMessage, trustProxyDepth: number = 0): string {
    const directIP = req.socket?.remoteAddress || "unknown";
    if (!Number.isInteger(trustProxyDepth) || trustProxyDepth <= 0) {
        return directIP;
    }

    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor !== undefined) {
        const forwardedIPs = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor).split(",").map((ip) => ip.trim());
        const clientIP = forwardedIPs[forwardedIPs.length - trustProxyDepth];
        return clientIP && isIP(clientIP) ? clientIP : directIP;
    }

    for (const name of ["cf-connecting-ip", "true-client-ip", "x-real-ip"]) {
        const value = req.headers[name];
        if (typeof value === "string" && isIP(value.trim())) {
            return value.trim();
        }
    }
    return directIP;
}

/** Uses the same depth-based extraction as extractClientIP. */
export function extractClientIPFromRight(req: http.IncomingMessage, trustProxyDepth: number = 0): string {
    return extractClientIP(req, trustProxyDepth);
}
