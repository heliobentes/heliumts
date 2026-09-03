// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";

import { HTTPRouter } from "../../src/server/httpRouter";

describe("HTTP response cookies", () => {
    it.each(
        [
            [],
            ["session_token=test; Path=/; HttpOnly"],
            ["state=; Max-Age=0; Path=/", "session_token=test; Path=/; HttpOnly", "session_data=cache; Expires=Wed, 09 Sep 2026 12:00:00 GMT; Path=/; HttpOnly"],
        ].map((cookies) => ({ cookies }))
    )("preserves redirect headers and $cookies", async ({ cookies }) => {
        const router = new HTTPRouter();
        const headers = new Headers({ location: "/" });
        cookies.forEach((cookie) => headers.append("set-cookie", cookie));
        router.registerRoutes([
            {
                name: "authCallback",
                handler: {
                    __kind: "http",
                    method: "GET",
                    path: "/api/auth/callback/google",
                    handler: () => new Response(null, { status: 302, headers }),
                },
            },
        ]);
        const socket = new Socket();
        const req = new IncomingMessage(socket);
        req.method = "GET";
        req.url = "/api/auth/callback/google";
        const res = new ServerResponse(req);
        try {
            expect(await router.handleRequest(req, res)).toBe(true);
            expect(res.statusCode).toBe(302);
            expect(res.getHeader("location")).toBe("/");
            expect(res.getHeader("set-cookie")).toEqual(cookies.length ? cookies : undefined);
        } finally {
            socket.destroy();
        }
    });
});
