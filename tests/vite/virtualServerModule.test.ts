import { describe, expect, it } from "vitest";

import type { HTTPHandlerExport, MethodExport, MiddlewareExport, WorkerExport } from "../../src/vite/scanner";
import { generateClientModule, generateEntryModule, generateServerManifest, generateTypeDefinitions } from "../../src/vite/virtualServerModule";

describe("virtualServerModule", () => {
    describe("generateClientModule", () => {
        it("should generate exports for methods", () => {
            const methods: MethodExport[] = [
                { name: "getUser", filePath: "/src/server/users.ts" },
                { name: "createUser", filePath: "/src/server/users.ts" },
            ];

            const result = generateClientModule(methods);

            expect(result).toContain("export const getUser = { __id: 'getUser' };");
            expect(result).toContain("export const createUser = { __id: 'createUser' };");
        });

        it("should return empty string for no methods", () => {
            const result = generateClientModule([]);

            expect(result).toBe("");
        });
    });

    describe("generateServerManifest", () => {
        it("should generate imports and registrations for methods", () => {
            const methods: MethodExport[] = [{ name: "getUser", filePath: "/src/server/users.ts" }];

            const result = generateServerManifest(methods, [], undefined, []);

            expect(result).toContain("import { getUser as method_0 } from '/src/server/users.ts';");
            expect(result).toContain("registry.register('getUser', method_0);");
        });

        it("should generate imports for HTTP handlers", () => {
            const httpHandlers: HTTPHandlerExport[] = [{ name: "webhookHandler", filePath: "/src/server/webhooks.ts" }];

            const result = generateServerManifest([], httpHandlers, undefined, []);

            expect(result).toContain("import { webhookHandler as http_0 } from '/src/server/webhooks.ts';");
            expect(result).toContain("{ name: 'webhookHandler', handler: http_0 },");
        });

        it("should generate imports for workers", () => {
            const workers: WorkerExport[] = [{ name: "queueWorker", filePath: "/src/server/workers/queue.ts" }];

            const result = generateServerManifest([], [], undefined, workers);

            expect(result).toContain("import { queueWorker as worker_0 } from '/src/server/workers/queue.ts';");
            expect(result).toContain("{ name: 'queueWorker', worker: worker_0 },");
        });

        it("should generate middleware import for named export", () => {
            const middleware: MiddlewareExport = {
                name: "authMiddleware",
                filePath: "/src/server/_middleware.ts",
            };

            const result = generateServerManifest([], [], middleware, []);

            expect(result).toContain("import { authMiddleware as middleware } from '/src/server/_middleware.ts';");
            expect(result).toContain("export const middlewareHandler = middleware;");
        });

        it("should generate middleware import for default export", () => {
            const middleware: MiddlewareExport = {
                name: "default",
                filePath: "/src/server/_middleware.ts",
            };

            const result = generateServerManifest([], [], middleware, []);

            expect(result).toContain("import middleware from '/src/server/_middleware.ts';");
        });

        it("should set middlewareHandler to null when no middleware", () => {
            const result = generateServerManifest([], [], undefined, []);

            expect(result).toContain("export const middlewareHandler = null;");
        });
    });

    describe("generateTypeDefinitions", () => {
        it("should generate type imports and exports", () => {
            const methods: MethodExport[] = [{ name: "getUser", filePath: "/test/project/src/server/users.ts" }];

            const result = generateTypeDefinitions(methods, "/test/project");

            expect(result).toContain("import type { getUser as");
            expect(result).toContain("declare module 'heliumts/server'");
            expect(result).toContain("export const getUser: import('heliumts/client').MethodStub<");
        });

        it("should include auto-generated header comment", () => {
            const result = generateTypeDefinitions([], "/test/project");

            expect(result).toContain("/* eslint-disable */");
            expect(result).toContain("Auto generated file - DO NOT EDIT!");
        });

        it("should include method signature comment with method names", () => {
            const methods: MethodExport[] = [
                { name: "getUser", filePath: "/test/project/src/server/users.ts" },
                { name: "createPost", filePath: "/test/project/src/server/posts.ts" },
            ];

            const result = generateTypeDefinitions(methods, "/test/project");

            // Methods are sorted alphabetically
            expect(result).toContain("@helium-methods createPost, getUser");
        });

        it("should include (none) signature when no methods exist", () => {
            const result = generateTypeDefinitions([], "/test/project");

            expect(result).toContain("@helium-methods (none)");
        });
    });

    describe("generateEntryModule", () => {
        it("should generate React entry point code", () => {
            const result = generateEntryModule();

            expect(result).toContain("import React from 'react';");
            expect(result).toContain("import { createRoot } from 'react-dom/client';");
            expect(result).toContain("import { AppRouter } from 'heliumts/client';");
            expect(result).toContain("import App from '/src/App';");
            expect(result).toContain("createRoot(rootEl).render(");
            expect(result).toContain("<AppRouter AppShell={App} />");
        });

        it("should include error handling for missing root element", () => {
            const result = generateEntryModule();

            expect(result).toContain("throw new Error('Root element not found");
        });
    });
});
