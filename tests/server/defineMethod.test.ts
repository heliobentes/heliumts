import { describe, expect, it } from "vitest";

import { defineMethod, type HeliumMethodDef } from "../../src/server/defineMethod";
import type { HeliumContext } from "../../src/server/context";

describe("defineMethod", () => {
    describe("defineMethod function", () => {
        it("should create a method definition from a handler", () => {
            const handler = async (args: { name: string }, ctx: HeliumContext) => {
                return { greeting: `Hello, ${args.name}!` };
            };

            const method = defineMethod(handler);

            expect(method.__kind).toBe("method");
            expect(method.handler).toBe(handler);
        });

        it("should set __id from handler function name", () => {
            function namedHandler(args: unknown, ctx: HeliumContext) {
                return "result";
            }

            const method = defineMethod(namedHandler);

            expect(method.__id).toBe("namedHandler");
        });

        it("should use empty string for anonymous handlers", () => {
            const method = defineMethod((args: unknown, ctx: HeliumContext) => "result");

            expect(method.__id).toBe("");
        });

        it("should throw when handler is not provided", () => {
            expect(() => defineMethod(null as unknown as (args: unknown, ctx: HeliumContext) => unknown)).toThrow(
                "defineMethod requires a handler"
            );
        });

        it("should preserve handler types", () => {
            interface Args {
                userId: number;
            }
            interface Result {
                user: { id: number; name: string };
            }

            const method: HeliumMethodDef<Args, Result> = defineMethod(
                async (args: Args, ctx: HeliumContext): Promise<Result> => {
                    return { user: { id: args.userId, name: "Test" } };
                }
            );

            expect(method.__kind).toBe("method");
        });

        it("should allow synchronous handlers", () => {
            const method = defineMethod((args: { x: number }, ctx: HeliumContext) => {
                return args.x * 2;
            });

            expect(method.__kind).toBe("method");
        });

        it("should allow async handlers", async () => {
            const method = defineMethod(async (args: { delay: number }, ctx: HeliumContext) => {
                await new Promise((resolve) => setTimeout(resolve, args.delay));
                return "done";
            });

            expect(method.__kind).toBe("method");

            // Verify the handler works
            const result = await method.handler({ delay: 0 }, {} as HeliumContext);
            expect(result).toBe("done");
        });
    });
});
