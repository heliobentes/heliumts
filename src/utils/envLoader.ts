import dotenv from "dotenv";
import fs from "fs";
import path from "path";

export interface EnvLoadOptions {
    root?: string;
    mode?: string;
}

/**
 * Collects HELIUM_PUBLIC_ prefixed variables from process.env.
 * Used as a fallback for platform environments (Render, DigitalOcean Apps, etc.)
 * where env vars are set as platform variables rather than .env files.
 */
export function getPublicEnvFromProcess(prefix: string = "HELIUM_PUBLIC_"): Record<string, string> {
    const publicEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(prefix) && value !== undefined) {
            publicEnv[key] = value;
        }
    }

    return publicEnv;
}

/**
 * Loads environment variables from .env files with priority.
 * Similar to Next.js, supports:
 * - .env.{mode}.local (highest priority)
 * - .env.local (not loaded in test mode)
 * - .env.{mode}
 * - .env
 * - process.env HELIUM_PUBLIC_* variables (lowest priority fallback)
 *
 * Platform environment variables (process.env) are used as the base layer,
 * so .env file values always take precedence. This ensures compatibility
 * with platforms like Render, DigitalOcean Apps, and Railway where env vars
 * are set as platform variables rather than .env files.
 */
export function loadEnvFiles(options: EnvLoadOptions = {}): Record<string, string> {
    const { root = process.cwd(), mode = process.env.NODE_ENV || "development" } = options;

    const envFiles = [
        `.env.${mode}.local`,
        // Don't load .env.local in test mode
        mode !== "test" ? `.env.local` : null,
        `.env.${mode}`,
        `.env`,
    ].filter(Boolean) as string[];

    // Start with platform env vars as the lowest-priority base layer
    const loadedEnv: Record<string, string> = getPublicEnvFromProcess();

    // Load in reverse order so earlier files override later ones
    for (let i = envFiles.length - 1; i >= 0; i--) {
        const envFile = envFiles[i];
        const envPath = path.resolve(root, envFile);

        if (fs.existsSync(envPath)) {
            const parsed = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
            Object.assign(loadedEnv, parsed);
        }
    }

    return loadedEnv;
}

/**
 * Injects env variables into process.env
 */
export function injectEnvToProcess(env: Record<string, string>): void {
    for (const [key, value] of Object.entries(env)) {
        // Don't override existing process.env values
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

/**
 * Filters env variables that should be exposed to the client.
 * By default, only HELIUM_PUBLIC_ prefixed variables are exposed.
 */
export function filterClientEnv(env: Record<string, string>, prefix: string = "HELIUM_PUBLIC_"): Record<string, string> {
    const clientEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
        if (key.startsWith(prefix)) {
            clientEnv[key] = value;
        }
    }

    return clientEnv;
}

/**
 * Generates an inline <script> tag that exposes HELIUM_PUBLIC_ env vars
 * via window.__HELIUM__.env before the client bundle executes.
 */
export function buildHeliumEnvScript(prefix: string = "HELIUM_PUBLIC_"): string {
    const publicEnv = getPublicEnvFromProcess(prefix);

    if (Object.keys(publicEnv).length === 0) {
        return "";
    }

    const envJson = JSON.stringify(publicEnv).replace(/</g, "\\u003c");
    return `<script>window.__HELIUM__=window.__HELIUM__||{};window.__HELIUM__.env=${envJson};</script>`;
}

/**
 * Injects the Helium bootstrap script into an HTML string, placing it
 * at the beginning of <head> so it runs before any module scripts.
 */
export function injectHeliumEnvIntoHtml(html: string, prefix: string = "HELIUM_PUBLIC_"): string {
    const script = buildHeliumEnvScript(prefix);

    if (!script) {
        return html;
    }

    // Inject at the start of <head> so it runs before module scripts
    const headMatch = html.match(/<head[^>]*>/i);
    if (headMatch) {
        return html.replace(headMatch[0], `${headMatch[0]}\n${script}`);
    }

    // Fallback: prepend to HTML
    return `${script}\n${html}`;
}
