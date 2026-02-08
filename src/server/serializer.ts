/**
 * Prepares data for MessagePack serialization by respecting .toJSON() methods.
 * This ensures that objects like ORM entities (Mongoose, Prisma, etc.) are
 * serialized correctly (hiding private fields, virtuals, etc.) and efficiently.
 *
 * It preserves MessagePack-supported types like Date and Uint8Array (Buffer).
 * Circular references are replaced with null to avoid runtime crashes.
 */
export function prepareForMsgpack(value: unknown): unknown {
    const stack = new WeakSet<object>();
    return prepareForMsgpackInner(value, stack);
}

function prepareForMsgpackInner(value: unknown, stack: WeakSet<object>): unknown {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value !== "object") {
        return value;
    }

    // Security: circular reference detection (only true cycles, not shared refs)
    if (stack.has(value as object)) {
        return null;
    }
    stack.add(value as object);

    // Preserve MessagePack supported types
    if (value instanceof Date) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return value;
    }

    // Handle toJSON (e.g. Mongoose documents, custom classes)
    const valueWithToJson = value as { toJSON?: () => unknown };
    if (typeof valueWithToJson.toJSON === "function") {
        const result = prepareForMsgpackInner(valueWithToJson.toJSON(), stack);
        stack.delete(value as object);
        return result;
    }

    // Handle Array
    if (Array.isArray(value)) {
        const result = value.map((item) => prepareForMsgpackInner(item, stack));
        stack.delete(value as object);
        return result;
    }

    // Handle Plain Objects
    // We create a new object to avoid mutating the original
    const newObj: Record<string, unknown> = {};
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            newObj[key] = prepareForMsgpackInner((value as Record<string, unknown>)[key], stack);
        }
    }
    stack.delete(value as object);
    return newObj;
}
