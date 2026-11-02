import type { IncomingMessage, ServerResponse } from "http";

import { log } from "../utils/logger.js";

/** Node's request event does not handle rejections from async listeners. */
export function withRequestErrorHandling(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        try {
            await handler(req, res);
        } catch (error) {
            log("error", "Request failed:", error);
            if (!res.headersSent) {
                const statusCode = error instanceof TypeError && error.message.includes("Invalid URL") ? 400 : 500;
                res.writeHead(statusCode, { "Content-Type": "text/plain" });
            }
            if (!res.writableEnded) {
                res.end("Request failed");
            }
        }
    };
}
