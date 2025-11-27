/**
 * Prepares data for MessagePack serialization by respecting .toJSON() methods.
 * This ensures that objects like ORM entities (Mongoose, Prisma, etc.) are
 * serialized correctly (hiding private fields, virtuals, etc.) and efficiently.
 *
 * It preserves MessagePack-supported types like Date and Uint8Array (Buffer).
 */
export function prepareForMsgpack(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;

    // Preserve MessagePack supported types
    if (value instanceof Date) return value;
    if (value instanceof Uint8Array) return value;

    // Handle toJSON (e.g. Mongoose documents, custom classes)
    if (typeof value.toJSON === "function") {
        return prepareForMsgpack(value.toJSON());
    }

    // Handle Array
    if (Array.isArray(value)) {
        return value.map(prepareForMsgpack);
    }

    // Handle Plain Objects
    // We create a new object to avoid mutating the original
    const newObj: Record<string, any> = {};
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            newObj[key] = prepareForMsgpack(value[key]);
        }
    }
    return newObj;
}
