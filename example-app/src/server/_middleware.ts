import { middleware } from "helium/server";

import { connectToDatabase } from "./db/connection";

/**
 * Example middleware that runs on every method call and HTTP request.
 *
 * This middleware:
 * - Logs all incoming requests
 * - Can add custom data to the context
 * - Can block requests by not calling next()
 */
export default middleware(async (context, next) => {
    await connectToDatabase();
    const timestamp = new Date().toISOString();

    if (context.type === "method") {
        console.log(`[${timestamp}] RPC Method: ${context.methodName}`);
    } else if (context.type === "http") {
        console.log(`[${timestamp}] HTTP Request: ${context.httpMethod} ${context.httpPath}`);
    }

    // Add custom data to context that will be available in handlers
    context.ctx.requestTimestamp = timestamp;
    context.ctx.requestId = Math.random().toString(36).substring(7);

    // Example: Block unauthenticated requests to certain methods
    // if (context.type === "method" && context.methodName === "deleteUser") {
    //     if (!context.ctx.user) {
    //         console.log("Blocked unauthenticated deleteUser request");
    //         return; // Don't call next() to block the request
    //     }
    // }

    // Example: Connect to a database before handling requests
    // await connectToDB();

    // Call next() to proceed to the handler
    await next();

    // You can also run code after the handler executes
    if (context.type === "method") {
        console.log(`[${timestamp}] RPC Method ${context.methodName} completed`);
    } else if (context.type === "http") {
        console.log(`[${timestamp}] HTTP Request ${context.httpMethod} ${context.httpPath} completed`);
    }
});
