import { defineMethod } from "helium/server";

export const getIP = defineMethod(async (_args, ctx) => {
    // Access client IP (extracted based on trustProxyDepth config)
    console.log("Client IP:", ctx.req.ip);

    // Access headers from the WebSocket upgrade request
    console.log("User-Agent:", ctx.req.headers["user-agent"]);

    // Access other request metadata
    console.log("Request URL:", ctx.req.url);
    console.log("Request Method:", ctx.req.method);

    return {
        ip: ctx.req.ip,
        headers: ctx.req.headers,
        url: ctx.req.url,
        method: ctx.req.method,
    };
});
