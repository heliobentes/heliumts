import { describe, expect, it } from "vitest";

import { prepareForMsgpack } from "../../src/server/serializer";

describe("serializer", () => {
    describe("prepareForMsgpack", () => {
        it("should return null and undefined as-is", () => {
            expect(prepareForMsgpack(null)).toBe(null);
            expect(prepareForMsgpack(undefined)).toBe(undefined);
        });

        it("should return primitives as-is", () => {
            expect(prepareForMsgpack("string")).toBe("string");
            expect(prepareForMsgpack(123)).toBe(123);
            expect(prepareForMsgpack(true)).toBe(true);
            expect(prepareForMsgpack(false)).toBe(false);
        });

        it("should preserve Date objects", () => {
            const date = new Date("2024-01-15T10:30:00Z");
            const result = prepareForMsgpack(date);

            expect(result).toBe(date);
            expect(result instanceof Date).toBe(true);
        });

        it("should preserve Uint8Array (Buffer)", () => {
            const buffer = new Uint8Array([1, 2, 3, 4, 5]);
            const result = prepareForMsgpack(buffer);

            expect(result).toBe(buffer);
            expect(result instanceof Uint8Array).toBe(true);
        });

        it("should preserve repeated Date and binary references", () => {
            const date = new Date("2026-01-01");
            const binary = new Uint8Array([1, 2]);
            expect(prepareForMsgpack([date, date, binary, binary])).toEqual([date, date, binary, binary]);
        });

        it("should preserve own __proto__ data without changing the output prototype", () => {
            const value = JSON.parse('{"__proto__":{"private":true},"visible":true}');
            const result = prepareForMsgpack(value) as Record<string, unknown>;
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
            expect(result["__proto__"]).toEqual({ private: true });
            expect(result.private).toBeUndefined();
        });

        it("should replace true cycles without losing shared object references", () => {
            const shared = { value: 1 };
            const value: Record<string, unknown> = { first: shared, second: shared };
            value.self = value;
            expect(prepareForMsgpack(value)).toEqual({ first: shared, second: shared, self: null });
        });

        it("should call toJSON on objects that implement it", () => {
            const obj = {
                privateField: "secret",
                publicField: "visible",
                toJSON() {
                    return { publicField: this.publicField };
                },
            };

            const result = prepareForMsgpack(obj);

            expect(result).toEqual({ publicField: "visible" });
            expect(result).not.toHaveProperty("privateField");
        });

        it("should process arrays recursively", () => {
            const arr = [1, "string", new Date("2024-01-15"), { toJSON: () => ({ processed: true }) }];

            const result = prepareForMsgpack(arr) as unknown[];

            expect(result[0]).toBe(1);
            expect(result[1]).toBe("string");
            expect(result[2] instanceof Date).toBe(true);
            expect(result[3]).toEqual({ processed: true });
        });

        it("should process nested objects", () => {
            const obj = {
                name: "Test",
                nested: {
                    value: 123,
                    deeper: {
                        toJSON: () => ({ simplified: true }),
                    },
                },
            };

            const result = prepareForMsgpack(obj);

            expect(result).toEqual({
                name: "Test",
                nested: { value: 123, deeper: { simplified: true } },
            });
        });

        it("should handle complex nested structures with toJSON", () => {
            const mongooseDoc = {
                _id: "abc123",
                __v: 0,
                password: "secret",
                username: "john",
                profile: {
                    bio: "Hello",
                    private: true,
                },
                toJSON() {
                    return {
                        id: this._id,
                        username: this.username,
                        profile: { bio: this.profile.bio },
                    };
                },
            };

            const result = prepareForMsgpack(mongooseDoc);

            expect(result).toEqual({
                id: "abc123",
                username: "john",
                profile: { bio: "Hello" },
            });
        });

        it("should only include own properties", () => {
            const proto = { inherited: "value" };
            const obj = Object.create(proto);
            obj.own = "property";

            const result = prepareForMsgpack(obj);

            expect(result).toEqual({ own: "property" });
            expect(result).not.toHaveProperty("inherited");
        });

        it("should handle array of objects with toJSON", () => {
            const users = [
                {
                    name: "Alice",
                    secret: "a",
                    toJSON: function () {
                        return { name: this.name };
                    },
                },
                {
                    name: "Bob",
                    secret: "b",
                    toJSON: function () {
                        return { name: this.name };
                    },
                },
            ];

            const result = prepareForMsgpack(users);

            expect(result).toEqual([{ name: "Alice" }, { name: "Bob" }]);
        });

        it("should handle nested toJSON that returns objects", () => {
            const obj = {
                toJSON() {
                    return {
                        level1: {
                            toJSON() {
                                return { level2: "value" };
                            },
                        },
                    };
                },
            };

            const result = prepareForMsgpack(obj);

            expect(result).toEqual({ level1: { level2: "value" } });
        });
    });
});
