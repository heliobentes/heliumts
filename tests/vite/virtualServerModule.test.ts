import { describe, expect, it } from "vitest";

import type { HTTPHandlerExport, MethodExport, MiddlewareExport, WorkerExport } from "../../src/vite/scanner";
import { generateEntryModule, generateServerManifest } from "../../src/vite/virtualServerModule";

describe("virtualServerModule", () => {
    describe("generateServerManifest", () => {
        it("should generate imports and registrations for methods", () => {
            const methods: MethodExport[] = [{ name: "getUser", filePath: "/src/server/users.ts" }];

            const result = generateServerManifest(methods, [], [], [], [], null, undefined, []);

            expect(result).toContain("import { getUser as method_0 } from '/src/server/users.ts';");
            expect(result).toContain("registry.register('getUser', method_0);");
        });

        it("should generate imports for HTTP handlers", () => {
            const httpHandlers: HTTPHandlerExport[] = [{ name: "webhookHandler", filePath: "/src/server/webhooks.ts" }];

            const result = generateServerManifest([], httpHandlers, [], [], [], null, undefined, []);

            expect(result).toContain("import { webhookHandler as http_0 } from '/src/server/webhooks.ts';");
            expect(result).toContain("{ name: 'webhookHandler', handler: http_0 },");
        });

        it("should generate imports for workers", () => {
            const workers: WorkerExport[] = [{ name: "queueWorker", filePath: "/src/server/workers/queue.ts" }];

            const result = generateServerManifest([], [], [], [], [], null, undefined, workers);

            expect(result).toContain("import { queueWorker as worker_0 } from '/src/server/workers/queue.ts';");
            expect(result).toContain("{ name: 'queueWorker', worker: worker_0 },");
        });

        it("should generate middleware import for named export", () => {
            const middleware: MiddlewareExport = {
                name: "authMiddleware",
                filePath: "/src/server/_middleware.ts",
            };

            const result = generateServerManifest([], [], [], [], [], null, middleware, []);

            expect(result).toContain("import { authMiddleware as middleware } from '/src/server/_middleware.ts';");
            expect(result).toContain("export const middlewareHandler = middleware;");
        });

        it("should generate middleware import for default export", () => {
            const middleware: MiddlewareExport = {
                name: "default",
                filePath: "/src/server/_middleware.ts",
            };

            const result = generateServerManifest([], [], [], [], [], null, middleware, []);

            expect(result).toContain("import middleware from '/src/server/_middleware.ts';");
        });

        it("should set middlewareHandler to null when no middleware", () => {
            const result = generateServerManifest([], [], [], [], [], null, undefined, []);

            expect(result).toContain("export const middlewareHandler = null;");
        });

        it("should generate imports for SEO metadata handlers", () => {
            const seoMetadata = [{ name: "albumMetadata", filePath: "/src/server/seo.ts" }];

            const result = generateServerManifest([], [], seoMetadata, [], [], null, undefined, []);

            expect(result).toContain("import { albumMetadata as seo_0 } from '/src/server/seo.ts';");
            expect(result).toContain("{ name: 'albumMetadata', handler: seo_0 },");
        });

        it("should embed page route patterns", () => {
            const result = generateServerManifest([], [], [], ["/", "/:username/:albumId"], [], null, undefined, []);

            expect(result).toContain('export const pageRoutePatterns = ["/","/:username/:albumId"];');
        });
    });

    describe("generateEntryModule", () => {
        it("should generate React entry point code", () => {
            const result = generateEntryModule();

            expect(result).toContain("import React from 'react';");
            expect(result).toContain("import { createRoot, hydrateRoot } from 'react-dom/client';");
            expect(result).toContain("import { AppRouter } from 'heliumts/client';");
            expect(result).toContain("import App from '/src/App';");
            expect(result).toContain("hydrateRoot(rootEl, app);");
            expect(result).toContain("createRoot(rootEl).render(app);");
            expect(result).toContain("<AppRouter AppShell={App} />");
        });

        it("should include error handling for missing root element", () => {
            const result = generateEntryModule();

            expect(result).toContain("throw new Error('Root element not found");
        });
    });
});
