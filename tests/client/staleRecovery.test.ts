import { describe, expect, it, vi } from "vitest";

import { installStaleClientRecovery, isChunkLoadError } from "../../src/client/staleRecovery";

class MemoryStorage {
    private values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.has(key) ? this.values.get(key)! : null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }
}

describe("stale client recovery", () => {
    it("detects known chunk-load signatures", () => {
        expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
        expect(isChunkLoadError({ message: "Importing a module script failed." })).toBe(true);
        expect(isChunkLoadError("Loading chunk 42 failed.")).toBe(true);
        expect(isChunkLoadError(new Error("Network error"))).toBe(false);
    });

    it("reloads once after long hidden duration when tab becomes visible", () => {
        let currentTime = 1000;
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installStaleClientRecovery({
            storage,
            now: () => currentTime,
            reload,
            staleThresholdMs: 10_000,
            reloadCooldownMs: 5_000,
            disableDedupe: true,
        });

        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));

        currentTime = 12_500;
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("does not reload after short hidden duration", () => {
        let currentTime = 2000;
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installStaleClientRecovery({
            storage,
            now: () => currentTime,
            reload,
            staleThresholdMs: 10_000,
            disableDedupe: true,
        });

        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));

        currentTime = 7_000;
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));

        expect(reload).not.toHaveBeenCalled();
    });

    it("reloads on chunk rejection and respects cooldown", () => {
        let currentTime = 100_000;
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installStaleClientRecovery({
            storage,
            now: () => currentTime,
            reload,
            reloadCooldownMs: 30_000,
            disableDedupe: true,
        });

        window.dispatchEvent(
            new PromiseRejectionEvent("unhandledrejection", {
                promise: Promise.resolve(),
                reason: new Error("Failed to fetch dynamically imported module"),
            }),
        );
        expect(reload).toHaveBeenCalledTimes(1);

        currentTime = 120_000;
        window.dispatchEvent(
            new PromiseRejectionEvent("unhandledrejection", {
                promise: Promise.resolve(),
                reason: new Error("ChunkLoadError: Loading chunk 8 failed"),
            }),
        );
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("uses pageshow persisted to recover stale bfcache sessions", () => {
        let currentTime = 100_000;
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installStaleClientRecovery({
            storage,
            now: () => currentTime,
            reload,
            staleThresholdMs: 5_000,
            disableDedupe: true,
        });

        window.dispatchEvent(new Event("pagehide"));
        currentTime = 107_000;
        const pageShowEvent = new Event("pageshow");
        Object.defineProperty(pageShowEvent, "persisted", { value: true });
        window.dispatchEvent(pageShowEvent);

        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("does not throw when sessionStorage access fails", () => {
        const windowWithFailingStorage = Object.create(window) as Window;

        Object.defineProperty(windowWithFailingStorage, "sessionStorage", {
            configurable: true,
            get() {
                throw new Error("sessionStorage unavailable");
            },
        });

        expect(() => {
            installStaleClientRecovery({
                windowObject: windowWithFailingStorage,
                documentObject: document,
                disableDedupe: true,
            });
        }).not.toThrow();
    });

    it("defers reload until the document becomes visible", () => {
        let currentTime = 200_000;
        const storage = new MemoryStorage();
        const reload = vi.fn();

        installStaleClientRecovery({
            storage,
            now: () => currentTime,
            reload,
            reloadCooldownMs: 30_000,
            disableDedupe: true,
        });

        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        window.dispatchEvent(
            new PromiseRejectionEvent("unhandledrejection", {
                promise: Promise.resolve(),
                reason: new Error("Failed to fetch dynamically imported module"),
            }),
        );
        expect(reload).not.toHaveBeenCalled();

        currentTime = 205_000;
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
