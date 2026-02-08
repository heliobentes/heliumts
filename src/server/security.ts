import crypto from "crypto";

import { log } from "../utils/logger.js";
import type { HeliumRpcSecurityConfig } from "./config.js";

// Module-scoped secrets — not accessible via globalThis enumeration
let SERVER_SECRET: string = "";
let SECURITY_CONFIG: Required<HeliumRpcSecurityConfig>;
let isInitialized = false;

export function initializeSecurity(config: Required<HeliumRpcSecurityConfig>): void {
    if (!isInitialized) {
        const envSecret = process.env.HELIUM_SECRET;
        if (!envSecret) {
            SERVER_SECRET = crypto.randomBytes(32).toString("hex");
            if (process.env.NODE_ENV === "production") {
                log("warn", "HELIUM_SECRET is not set. A random secret was generated. Tokens will NOT verify across cluster instances or restarts. Set HELIUM_SECRET for production.");
            }
        } else {
            SERVER_SECRET = envSecret;
        }
        SECURITY_CONFIG = config;
        isInitialized = true;
        log("info", "Security module initialized");
    }
}

export function generateConnectionToken(): string {
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac("sha256", SERVER_SECRET);
    hmac.update(timestamp);
    const signature = hmac.digest("hex");
    return `${timestamp}.${signature}`;
}

export function verifyConnectionToken(token: string): boolean {
    if (!token) {
        log("warn", "Token missing");
        return false;
    }

    const [timestamp, signature] = token.split(".");
    if (!timestamp || !signature) {
        log("warn", "Invalid token format");
        return false;
    }

    // Check if token is expired
    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    const validityMs = SECURITY_CONFIG?.tokenValidityMs ?? 10000;
    if (isNaN(ts) || now - ts > validityMs || ts > now + 1000) {
        log("warn", `Token expired. TS: ${ts}, Now: ${now}, Diff: ${now - ts}, ValidityMs: ${validityMs}`);
        return false;
    }

    const hmac = crypto.createHmac("sha256", SERVER_SECRET);
    hmac.update(timestamp);
    const expectedSignature = hmac.digest("hex");

    if (signature.length !== expectedSignature.length) {
        log("warn", "Signature length mismatch");
        return false;
    }

    const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    if (!isValid) {
        log("warn", "Invalid signature");
    }
    return isValid;
}

/**
 * Reset security state. Only for testing.
 * @internal
 */
export function resetSecurity(): void {
    SERVER_SECRET = "";
    isInitialized = false;
}