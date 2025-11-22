import { defineHTTPRequest } from "helium/server";

// Example catch-all handler that responds to any HTTP method
export const healthCheck = defineHTTPRequest("ALL", "/health", async (req, ctx) => {
    return {
        status: "ok",
        timestamp: new Date().toISOString(),
        method: req.method,
    };
});

// Example catch-all for a specific path pattern
export const apiCatchAll = defineHTTPRequest("ALL", "/api/:resource", async (req, ctx) => {
    const { resource } = req.params;

    return {
        message: `Caught ${req.method} request for resource: ${resource}`,
        method: req.method,
        resource,
        query: req.query,
    };
});
