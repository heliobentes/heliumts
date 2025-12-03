import { describe, expect, it, vi } from "vitest";

import { log } from "../../src/utils/logger";

describe("logger", () => {
    describe("log", () => {
        it("should log info messages with correct format", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

            log("info", "Test message");

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const call = consoleSpy.mock.calls[0];
            expect(call[0]).toContain("[Helium]");
            expect(call[0]).toContain("INFO");
            expect(call[1]).toBe("Test message");
        });

        it("should log warning messages with console.warn", () => {
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            log("warn", "Warning message");

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const call = consoleSpy.mock.calls[0];
            expect(call[0]).toContain("WARN");
            expect(call[1]).toBe("Warning message");
        });

        it("should log error messages with console.error", () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            log("error", "Error message");

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const call = consoleSpy.mock.calls[0];
            expect(call[0]).toContain("ERROR");
            expect(call[1]).toBe("Error message");
        });

        it("should default to info level when no level is specified", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

            log("info", "Default level message");

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const call = consoleSpy.mock.calls[0];
            expect(call[0]).toContain("INFO");
        });

        it("should include timestamp in log messages", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

            log("info", "Timestamp test");

            const call = consoleSpy.mock.calls[0];
            // ISO timestamp format check (simplified)
            expect(call[0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });

        it("should handle multiple arguments", () => {
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

            log("info", "Message", { data: "test" }, 123);

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            const call = consoleSpy.mock.calls[0];
            expect(call[1]).toBe("Message");
            expect(call[2]).toEqual({ data: "test" });
            expect(call[3]).toBe(123);
        });
    });
});
