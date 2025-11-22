import crypto from "crypto";

import { log } from "../utils/logger.js";
import type { HeliumSecurityConfig } from "./config.js";

// Generate a random secret for this server instance if one isn't provided
const GLOBAL_SECRET_KEY = Symbol.for("helium.server.secret");
const GLOBAL_CONFIG_KEY = Symbol.for("helium.server.securityConfig");

let SERVER_SECRET: string;
let SECURITY_CONFIG: Required<HeliumSecurityConfig>;

export function initializeSecurity(config: Required<HeliumSecurityConfig>): void {
    const globalSymbols = Object.getOwnPropertySymbols(globalThis);
    const hasSecret = globalSymbols.indexOf(GLOBAL_SECRET_KEY) > -1;

    if (!hasSecret) {
        const secret = process.env.HELIUM_SECRET || crypto.randomBytes(32).toString("hex");
        (globalThis as any)[GLOBAL_SECRET_KEY] = secret;
        (globalThis as any)[GLOBAL_CONFIG_KEY] = config;
        log("info", `Initialized with secret hash: ${crypto.createHash("sha256").update(secret).digest("hex").substring(0, 8)}`);
    }

    SERVER_SECRET = (globalThis as any)[GLOBAL_SECRET_KEY] as string;
    SECURITY_CONFIG = (globalThis as any)[GLOBAL_CONFIG_KEY] as Required<HeliumSecurityConfig>;
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
