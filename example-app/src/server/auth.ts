import { defineHTTPRequest } from "helium/server";

import { auth } from "../auth";

export const betterAuthHttp = defineHTTPRequest("ALL", "/api/auth/*", async (req, _ctx) => {
    console.log("🚀 ~ req:", req);
    // Call the better-auth handler directly
    const response = await auth.handler(
        new Request(`${req.headers["x-forwarded-proto"] || "http"}://${req.headers["host"] || "localhost"}${req.path}`, {
            method: req.method,
            headers: new Headers(
                Object.entries(req.headers).reduce(
                    (acc, [key, value]) => {
                        if (value) {
                            acc[key] = Array.isArray(value) ? value.join(", ") : value;
                        }
                        return acc;
                    },
                    {} as Record<string, string>
                )
            ),
            body: req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined,
        })
    );

    // Return the response
    return response;
});
