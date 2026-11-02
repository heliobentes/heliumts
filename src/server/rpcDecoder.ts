import { decode } from "@msgpack/msgpack";

export const MAX_RPC_REQUEST_DEPTH = 128;

/** Validate container obligations before the decoder preallocates their arrays. */
function validateStructure(bytes: Buffer): void {
    const remainingChildren = new Uint32Array(MAX_RPC_REQUEST_DEPTH);
    let depth = 0;
    let offset = 0;
    let outstandingValues = 1;
    const invalid = () => {
        throw new RangeError("Invalid MessagePack request structure");
    };
    const skip = (size: number) => {
        if (size > bytes.byteLength - offset) {
            invalid();
        }
        offset += size;
    };
    const length = (size: 1 | 2 | 4): number => {
        skip(size);
        return size === 1 ? bytes[offset - 1]! : size === 2 ? bytes.readUInt16BE(offset - 2) : bytes.readUInt32BE(offset - 4);
    };

    while (outstandingValues > 0) {
        if (offset >= bytes.byteLength) {
            invalid();
        }
        while (depth > 0 && remainingChildren[depth - 1] === 0) {
            depth--;
        }
        if (depth > 0) {
            remainingChildren[depth - 1] = remainingChildren[depth - 1]! - 1;
        }
        outstandingValues--;
        const tag = bytes[offset++]!;
        let children = 0;
        let container = false;
        if (tag <= 0x7f || tag >= 0xe0 || tag === 0xc0 || tag === 0xc2 || tag === 0xc3) {
            // Integers, nil, and booleans carry no additional bytes.
        } else if (tag <= 0x8f) {
            container = true;
            children = 2 * (tag & 0x0f);
        } else if (tag <= 0x9f) {
            container = true;
            children = tag & 0x0f;
        } else if (tag <= 0xbf) {
            skip(tag & 0x1f);
        } else {
            switch (tag) {
                case 0xc4: // bin8
                case 0xd9: // str8
                    skip(length(1));
                    break;
                case 0xc5: // bin16
                case 0xda: // str16
                    skip(length(2));
                    break;
                case 0xc6: // bin32
                case 0xdb: // str32
                    skip(length(4));
                    break;
                case 0xc7: // ext8 includes its type byte
                    skip(length(1) + 1);
                    break;
                case 0xc8: // ext16
                    skip(length(2) + 1);
                    break;
                case 0xc9: // ext32
                    skip(length(4) + 1);
                    break;
                case 0xcc: // uint8
                case 0xd0: // int8
                    skip(1);
                    break;
                case 0xcd: // uint16
                case 0xd1: // int16
                    skip(2);
                    break;
                case 0xca: // float32
                case 0xce: // uint32
                case 0xd2: // int32
                    skip(4);
                    break;
                case 0xcb: // float64
                case 0xcf: // uint64
                case 0xd3: // int64
                    skip(8);
                    break;
                case 0xd4: // fixext1, plus type byte
                    skip(2);
                    break;
                case 0xd5: // fixext2
                    skip(3);
                    break;
                case 0xd6: // fixext4, including timestamp32
                    skip(5);
                    break;
                case 0xd7: // fixext8, including timestamp64
                    skip(9);
                    break;
                case 0xd8: // fixext16
                    skip(17);
                    break;
                case 0xdc: // array16
                case 0xdd: // array32
                    container = true;
                    children = length(tag === 0xdc ? 2 : 4);
                    break;
                case 0xde: // map16
                case 0xdf: // map32
                    container = true;
                    children = 2 * length(tag === 0xde ? 2 : 4);
                    break;
                default: // 0xc1 is reserved.
                    invalid();
            }
        }
        outstandingValues += children;
        // Every outstanding child needs at least one encoded byte. Checking the
        // sum also rejects nested declarations that pass individual size caps.
        if (outstandingValues > bytes.byteLength - offset) {
            invalid();
        }
        if (container) {
            if (depth >= MAX_RPC_REQUEST_DEPTH) {
                invalid();
            }
            if (children > 0) {
                remainingChildren[depth++] = children;
            }
        }
    }
    if (offset !== bytes.byteLength) {
        invalid();
    }
}

/** Reject impossible declared sizes before the MessagePack decoder allocates them. */
export function decodeRpcRequest(body: Buffer | string): unknown {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    validateStructure(bytes);
    return decode(bytes, {
        maxStrLength: bytes.byteLength,
        maxBinLength: bytes.byteLength,
        maxArrayLength: bytes.byteLength,
        maxMapLength: bytes.byteLength,
        maxExtLength: bytes.byteLength,
    });
}
