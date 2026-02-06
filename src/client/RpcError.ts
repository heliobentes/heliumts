import type { RpcStats } from "../runtime/protocol.js";

/**
 * Custom error class for RPC failures.
 *
 * Thrown when a server-side method throws an error. This ensures that
 * errors from the backend propagate as real `Error` instances on the
 * frontend, so they surface in `try / catch`, React error boundaries,
 * and developer tools.
 *
 * Properties:
 * - `message` – the error message sent by the server.
 * - `stats`   – rate-limit / request stats returned alongside the error.
 */
export class RpcError extends Error {
    /** Rate-limit / request stats returned alongside the error. */
    public readonly stats: RpcStats | null;

    constructor(message: string, stats?: RpcStats | null) {
        super(message);
        this.name = "RpcError";
        this.stats = stats ?? null;
    }
}
