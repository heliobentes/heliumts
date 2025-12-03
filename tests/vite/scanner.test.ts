import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scanServerExports, scanServerMethods, scanPageRoutes, checkRouteCollisions, type ServerExports } from "../../src/vite/scanner";

describe("scanner", () => {
    let existsSyncSpy: ReturnType<typeof vi.spyOn>;
    let readdirSyncSpy: ReturnType<typeof vi.spyOn>;
    let statSyncSpy: ReturnType<typeof vi.spyOn>;
    let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        existsSyncSpy = vi.spyOn(fs, "existsSync");
        readdirSyncSpy = vi.spyOn(fs, "readdirSync");
        statSyncSpy = vi.spyOn(fs, "statSync");
        readFileSyncSpy = vi.spyOn(fs, "readFileSync");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("scanServerExports", () => {
        it("should return empty arrays when server directory does not exist", () => {
            existsSyncSpy.mockReturnValue(false);

            const result = scanServerExports("/test/project");

            expect(result).toEqual({ methods: [], httpHandlers: [], workers: [] });
        });

        it("should find methods defined with defineMethod", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["users.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                import { defineMethod } from 'heliumts/server';

                export const getUser = defineMethod(async (args) => {
                    return { user: {} };
                });

                export const createUser = defineMethod(async (args) => {
                    return { success: true };
                });
            `);

            const result = scanServerExports("/test/project");

            expect(result.methods).toHaveLength(2);
            expect(result.methods[0].name).toBe("getUser");
            expect(result.methods[1].name).toBe("createUser");
        });

        it("should find HTTP handlers defined with defineHTTPRequest", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["webhooks.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                import { defineHTTPRequest } from 'heliumts/server';

                export const handleWebhook = defineHTTPRequest('POST', '/webhook', async (req) => {
                    return { ok: true };
                });
            `);

            const result = scanServerExports("/test/project");

            expect(result.httpHandlers).toHaveLength(1);
            expect(result.httpHandlers[0].name).toBe("handleWebhook");
        });

        it("should find workers defined with defineWorker", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["workers.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                import { defineWorker } from 'heliumts/server';

                export const queueProcessor = defineWorker(async () => {
                    // Process queue
                });
            `);

            const result = scanServerExports("/test/project");

            expect(result.workers).toHaveLength(1);
            expect(result.workers[0].name).toBe("queueProcessor");
        });

        it("should find middleware in _middleware.ts", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["_middleware.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                import { middleware } from 'heliumts/server';

                export const authMiddleware = middleware(async (ctx, next) => {
                    await next();
                });
            `);

            const result = scanServerExports("/test/project");

            expect(result.middleware).toBeDefined();
            expect(result.middleware!.name).toBe("authMiddleware");
        });

        it("should find default export middleware", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["_middleware.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                import { middleware } from 'heliumts/server';

                export default middleware(async (ctx, next) => {
                    await next();
                });
            `);

            const result = scanServerExports("/test/project");

            expect(result.middleware).toBeDefined();
            expect(result.middleware!.name).toBe("default");
        });

        it("should scan nested directories", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockImplementation((dir) => {
                if (dir.toString().endsWith("server")) {
                    return ["nested"] as unknown as fs.Dirent[];
                }
                return ["users.ts"] as unknown as fs.Dirent[];
            });
            statSyncSpy.mockImplementation((p) => {
                const pStr = p.toString();
                return {
                    isDirectory: () => pStr.endsWith("nested"),
                } as fs.Stats;
            });
            readFileSyncSpy.mockReturnValue(`
                export const getUser = defineMethod(async () => ({}));
            `);

            const result = scanServerExports("/test/project");

            expect(result.methods).toHaveLength(1);
        });
    });

    describe("scanServerMethods", () => {
        it("should return only methods from scanServerExports", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["api.ts"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);
            readFileSyncSpy.mockReturnValue(`
                export const myMethod = defineMethod(async () => ({}));
                export const myHandler = defineHTTPRequest('GET', '/test', async () => ({}));
            `);

            const result = scanServerMethods("/test/project");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("myMethod");
        });
    });

    describe("scanPageRoutes", () => {
        it("should return empty when pages directory does not exist", () => {
            existsSyncSpy.mockReturnValue(false);

            const result = scanPageRoutes("/test/project");

            expect(result).toEqual({ collisions: [], totalRoutes: 0 });
        });

        it("should detect route collisions between file and folder index", () => {
            existsSyncSpy.mockReturnValue(true);

            // Set up directory structure: about.tsx and about/index.tsx both resolve to /about
            readdirSyncSpy.mockImplementation((dir) => {
                const dirStr = dir.toString();
                if (dirStr.endsWith("/pages")) {
                    return ["about.tsx", "about"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/about")) {
                    return ["index.tsx"] as unknown as fs.Dirent[];
                }
                return [] as unknown as fs.Dirent[];
            });

            statSyncSpy.mockImplementation((p) => {
                const pStr = p.toString();
                return {
                    isDirectory: () => pStr.endsWith("/about") && !pStr.includes(".tsx"),
                } as fs.Stats;
            });

            const result = scanPageRoutes("/test/project");

            // Both about.tsx and about/index.tsx resolve to /about
            expect(result.collisions).toHaveLength(1);
            expect(result.collisions[0].pattern).toBe("/about");
            expect(result.collisions[0].files).toHaveLength(2);
        });

        it("should detect multiple collisions for the same pattern", () => {
            existsSyncSpy.mockReturnValue(true);

            // Set up: about.tsx, about/index.tsx, and about/page.tsx all potentially conflicting
            readdirSyncSpy.mockImplementation((dir) => {
                const dirStr = dir.toString();
                if (dirStr.endsWith("/pages")) {
                    return ["about.tsx", "about"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/about")) {
                    return ["index.tsx"] as unknown as fs.Dirent[];
                }
                return [] as unknown as fs.Dirent[];
            });

            statSyncSpy.mockImplementation((p) => {
                const pStr = p.toString();
                return {
                    isDirectory: () => pStr.endsWith("/about") && !pStr.includes(".tsx"),
                } as fs.Stats;
            });

            const result = scanPageRoutes("/test/project");

            expect(result.collisions.length).toBeGreaterThanOrEqual(1);
        });

        it("should skip layout files", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["_layout.tsx", "index.tsx"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

            const result = scanPageRoutes("/test/project");

            // Layout should be skipped, only index counted
            expect(result.totalRoutes).toBe(1);
        });

        it("should skip 404 page", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["404.tsx", "index.tsx"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

            const result = scanPageRoutes("/test/project");

            // 404 should be skipped
            expect(result.totalRoutes).toBe(1);
        });

        it("should convert dynamic route segments to patterns", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["[id].tsx", "[id].jsx"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

            const result = scanPageRoutes("/test/project");

            // [id].tsx and [id].jsx both resolve to /:id pattern
            expect(result.collisions).toHaveLength(1);
            expect(result.collisions[0].pattern).toBe("/:id");
        });

        it("should handle nested dynamic routes", () => {
            existsSyncSpy.mockReturnValue(true);

            readdirSyncSpy.mockImplementation((dir) => {
                const dirStr = dir.toString();
                if (dirStr.endsWith("/pages")) {
                    return ["users"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/users")) {
                    return ["[userId]"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/[userId]")) {
                    return ["posts"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/posts")) {
                    return ["[postId].tsx"] as unknown as fs.Dirent[];
                }
                return [] as unknown as fs.Dirent[];
            });

            statSyncSpy.mockImplementation((p) => {
                const pStr = p.toString();
                return {
                    isDirectory: () => !pStr.endsWith(".tsx"),
                } as fs.Stats;
            });

            const result = scanPageRoutes("/test/project");

            expect(result.totalRoutes).toBe(1);
            expect(result.collisions).toHaveLength(0);
        });

        it("should skip non-page file extensions", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["index.tsx", "styles.css", "about.tsx"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

            const result = scanPageRoutes("/test/project");

            // Only .tsx files should be counted, .css should be skipped
            expect(result.totalRoutes).toBe(2);
        });
    });

    describe("checkRouteCollisions", () => {
        it("should return false when no collisions", () => {
            existsSyncSpy.mockReturnValue(true);
            readdirSyncSpy.mockReturnValue(["index.tsx", "about.tsx"] as unknown as fs.Dirent[]);
            statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

            const result = checkRouteCollisions("/test/project");

            expect(result).toBe(false);
        });

        it("should return true and log warnings when collisions exist", () => {
            existsSyncSpy.mockReturnValue(true);

            readdirSyncSpy.mockImplementation((dir) => {
                const dirStr = dir.toString();
                if (dirStr.endsWith("/pages")) {
                    return ["about.tsx", "about"] as unknown as fs.Dirent[];
                }
                if (dirStr.endsWith("/about")) {
                    return ["index.tsx"] as unknown as fs.Dirent[];
                }
                return [] as unknown as fs.Dirent[];
            });

            statSyncSpy.mockImplementation((p) => {
                const pStr = p.toString();
                return {
                    isDirectory: () => pStr.endsWith("/about") && !pStr.includes(".tsx"),
                } as fs.Stats;
            });

            const result = checkRouteCollisions("/test/project");

            expect(result).toBe(true);
            expect(console.warn).toHaveBeenCalled();
            expect(console.error).toHaveBeenCalled();
        });
    });
});
