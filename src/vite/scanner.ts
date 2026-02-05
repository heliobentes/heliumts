import fs from "fs";
import path from "path";

import { log } from "../utils/logger.js";
import { SERVER_DIR } from "./paths.js";

export interface MethodExport {
    name: string;
    filePath: string;
}

export interface HTTPHandlerExport {
    name: string;
    filePath: string;
}

export interface MiddlewareExport {
    name: string;
    filePath: string;
}

export interface WorkerExport {
    name: string;
    filePath: string;
}

export interface ServerExports {
    methods: MethodExport[];
    httpHandlers: HTTPHandlerExport[];
    middleware?: MiddlewareExport;
    workers: WorkerExport[];
}

export function scanServerMethods(root: string): MethodExport[] {
    const exports = scanServerExports(root);
    return exports.methods;
}

export function scanServerExports(root: string): ServerExports {
    const serverDir = path.resolve(root, SERVER_DIR);
    if (!fs.existsSync(serverDir)) {
        return { methods: [], httpHandlers: [], workers: [] };
    }

    const methods: MethodExport[] = [];
    const httpHandlers: HTTPHandlerExport[] = [];
    const workers: WorkerExport[] = [];
    let middleware: MiddlewareExport | undefined;

    function walk(dir: string) {
        let files: string[];
        try {
            files = fs.readdirSync(dir);
        } catch {
            // Directory might have been deleted during scan
            return;
        }
        for (const file of files) {
            const fullPath = path.join(dir, file);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(fullPath);
            } catch {
                // File might have been deleted during scan
                continue;
            }

            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (file.endsWith(".ts")) {
                let content: string;
                try {
                    content = fs.readFileSync(fullPath, "utf-8");
                } catch {
                    // File might be being written to or deleted
                    continue;
                }

                // Check for _middleware.ts file
                if (file === "_middleware.ts") {
                    // Support both 'middleware' and 'defineMiddleware' (backwards compatibility)
                    const middlewareRegex = /export\s+(const|default)\s+(\w+)\s*=\s*(middleware|defineMiddleware)/;
                    const match = middlewareRegex.exec(content);
                    if (match) {
                        middleware = {
                            name: match[2],
                            filePath: fullPath,
                        };
                    }
                    // Also support default export
                    const defaultRegex = /export\s+default\s+(middleware|defineMiddleware)/;
                    if (defaultRegex.test(content)) {
                        middleware = {
                            name: "default",
                            filePath: fullPath,
                        };
                    }
                }

                // Find: export const methodName = defineMethod(...)
                const methodRegex = /export\s+const\s+(\w+)\s*=\s*defineMethod/g;
                let match;
                while ((match = methodRegex.exec(content)) !== null) {
                    methods.push({
                        name: match[1],
                        filePath: fullPath,
                    });
                }

                // Find: export const handlerName = defineHTTPRequest(...)
                const httpRegex = /export\s+const\s+(\w+)\s*=\s*defineHTTPRequest/g;
                while ((match = httpRegex.exec(content)) !== null) {
                    httpHandlers.push({
                        name: match[1],
                        filePath: fullPath,
                    });
                }

                // Find: export const workerName = defineWorker(...)
                const workerRegex = /export\s+const\s+(\w+)\s*=\s*defineWorker/g;
                while ((match = workerRegex.exec(content)) !== null) {
                    workers.push({
                        name: match[1],
                        filePath: fullPath,
                    });
                }
            }
        }
    }

    walk(serverDir);
    return { methods, httpHandlers, middleware, workers };
}

/**
 * Convert a file path to a route pattern (same logic as client-side router)
 */
function pathFromFile(file: string, root: string): string {
    // Remove root/src/pages prefix and file extension
    const pagesDir = path.join(root, "src", "pages");
    const withoutPrefix = file.replace(pagesDir, "").replace(/\.(tsx|jsx|ts|js)$/, "");

    // Handle special files
    if (withoutPrefix === "/404") {
        return "__404__";
    }

    // Remove route groups (folders in parentheses)
    let pattern = withoutPrefix.replace(/\/\([^)]+\)/g, "");

    // Convert /index to /
    pattern = pattern.replace(/\/index$/, "") || "/";
    // Convert [...param] to *param (catch-all)
    pattern = pattern.replace(/\[\.\.\.(.+?)\]/g, "*$1");
    // Convert [param] to :param (single dynamic segment)
    pattern = pattern.replace(/\[(.+?)\]/g, ":$1");

    return pattern;
}

export interface RouteCollision {
    pattern: string;
    files: string[];
}

/**
 * Scan pages directory and detect route collisions
 */
export function scanPageRoutes(root: string): { collisions: RouteCollision[]; totalRoutes: number } {
    const pagesDir = path.join(root, "src", "pages");

    if (!fs.existsSync(pagesDir)) {
        return { collisions: [], totalRoutes: 0 };
    }

    const routePatternMap = new Map<string, string>();
    const collisions: RouteCollision[] = [];

    function walkPages(dir: string) {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                walkPages(fullPath);
            } else if (/\.(tsx|jsx|ts|js)$/.test(item)) {
                // Skip layout files
                if (item.includes("_layout.")) {
                    continue;
                }

                const pathPattern = pathFromFile(fullPath, root);

                // Skip special pages
                if (pathPattern === "__404__") {
                    continue;
                }

                // Check for collision
                const existingFile = routePatternMap.get(pathPattern);
                if (existingFile) {
                    // Check if this collision was already recorded
                    const existingCollision = collisions.find((c) => c.pattern === pathPattern);
                    if (existingCollision) {
                        existingCollision.files.push(fullPath);
                    } else {
                        collisions.push({
                            pattern: pathPattern,
                            files: [existingFile, fullPath],
                        });
                    }
                } else {
                    routePatternMap.set(pathPattern, fullPath);
                }
            }
        }
    }

    walkPages(pagesDir);
    return { collisions, totalRoutes: routePatternMap.size };
}

/**
 * Check for route collisions and log warnings
 */
export function checkRouteCollisions(root: string): boolean {
    const { collisions, totalRoutes } = scanPageRoutes(root);

    if (collisions.length === 0) {
        return false;
    }

    log("warn", "⚠️  Route collisions detected! Multiple files resolve to the same URL path:");
    log("warn", "");

    for (const collision of collisions) {
        log("error", `  Route pattern: "${collision.pattern}"`);
        for (const file of collision.files) {
            const relative = path.relative(root, file);
            log("error", `    - ${relative}`);
        }
        log("error", `  ⚠️  Only the first file will be accessible.`);
        log("warn", "");
    }

    log("warn", `Found ${collisions.length} collision(s) across ${totalRoutes} unique routes.`);
    log("warn", "Consider using different file names or organizing files in subdirectories.");
    log("warn", "");

    return true;
}
