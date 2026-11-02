# Context API

## Overview

Every RPC method and HTTP handler in Helium receives a `HeliumContext` object as the second parameter. This context provides access to request metadata, including the client IP, current HTTP headers, and an abort signal.

## Context Structure

```typescript
interface HeliumContext {
    signal: AbortSignal; // Aborted on request cancellation/disconnect
    req: {
        ip: string; // Client IP (respects trustProxyDepth config)
        headers: http.IncomingHttpHeaders; // Request headers
        url?: string; // Request URL
        method?: string; // HTTP method
        raw: http.IncomingMessage; // Raw Node.js request object
    };
    [key: string]: unknown; // Custom properties from middleware
}
```

## Usage in RPC Methods

```typescript
import { defineMethod } from "heliumts/server";

export const getClientInfo = defineMethod(async (args, ctx) => {
    // Access client IP (extracted based on trustProxyDepth configuration)
    console.log("Client IP:", ctx.req.ip);

    // Access request headers
    const userAgent = ctx.req.headers["user-agent"];
    const acceptLanguage = ctx.req.headers["accept-language"];

    // Access the current HTTP request URL
    console.log("Request URL:", ctx.req.url);

    return {
        ip: ctx.req.ip,
        userAgent,
        language: acceptLanguage,
    };
});
```

## Usage in HTTP Handlers

```typescript
import { defineHTTPRequest } from "heliumts/server";

export const apiEndpoint = defineHTTPRequest("POST", "/api/data", async (req, ctx) => {
    // Access client IP
    console.log("Client IP:", ctx.req.ip);

    // Access request headers
    const authorization = ctx.req.headers["authorization"];

    // Check if request is from a specific IP range
    if (ctx.req.ip.startsWith("10.0.")) {
        return { error: "Internal network not allowed" };
    }

    return { success: true };
});
```

## IP Detection

The `ctx.req.ip` field contains the client's IP address, extracted based on your `trustProxyDepth` configuration:

```typescript
// helium.config.ts
const config: HeliumConfig = {
    trustProxyDepth: 1, // Trust one proxy level
};
```

The IP extraction checks multiple headers automatically:

1. **CF-Connecting-IP** (Cloudflare)
2. **True-Client-IP** (Cloudflare Enterprise, Akamai)
3. **X-Real-IP** (Nginx)
4. **X-Forwarded-For** (Standard)
5. **Direct connection** (fallback)

See [Proxy Configuration](./proxy-configuration.md) for more details.

## Custom Context Properties

Middleware can add custom properties to the context:

```typescript
import { middleware } from "heliumts/server";

export const authMiddleware = middleware(async (context, next) => {
    // Add custom property
    context.ctx.user = await getUserFromToken(context.ctx.req.headers["authorization"]);

    await next();
});
```

Then access it in your handlers:

```typescript
export const getProfile = defineMethod(async (args, ctx) => {
    // TypeScript: cast to access custom properties
    const user = (ctx as any).user;

    return {
        username: user.name,
        email: user.email,
    };
});
```

## Common Use Cases

### 1. Rate Limiting by IP

```typescript
const rateLimitCache = new Map<string, number>();

export const limitedEndpoint = defineMethod(async (args, ctx) => {
    const ip = ctx.req.ip;
    const count = rateLimitCache.get(ip) || 0;

    if (count > 100) {
        throw new Error("Rate limit exceeded");
    }

    rateLimitCache.set(ip, count + 1);

    return { success: true };
});
```

### 2. Geolocation

```typescript
export const getLocation = defineMethod(async (args, ctx) => {
    const ip = ctx.req.ip;
    const location = await lookupGeoIP(ip);

    return {
        ip,
        country: location.country,
        city: location.city,
    };
});
```

### 3. Security Checks

```typescript
export const secureEndpoint = defineMethod(async (args, ctx) => {
    const ip = ctx.req.ip;

    // Block specific IP ranges
    if (isBlacklisted(ip)) {
        throw new Error("Access denied");
    }

    // Only allow certain IPs
    if (!isWhitelisted(ip)) {
        throw new Error("Unauthorized");
    }

    return { success: true };
});
```

### 4. Logging and Analytics

```typescript
export const trackEvent = defineMethod(async (args, ctx) => {
    await logEvent({
        event: args.eventName,
        ip: ctx.req.ip,
        userAgent: ctx.req.headers["user-agent"],
        timestamp: Date.now(),
    });

    return { tracked: true };
});
```

## Best Practices

1. **Always use `ctx.req.ip` instead of parsing headers manually** - it respects your proxy configuration
2. **Be cautious with IP-based restrictions** - users behind NAT may share IPs
3. **Don't log sensitive header information** - be mindful of privacy
4. **Use TypeScript types** - import `HeliumContext` for better type safety:
    ```typescript
    import type { HeliumContext } from "heliumts/server";
    ```
5. **Configure `trustProxyDepth` correctly** - see [Proxy Configuration](./proxy-configuration.md)

## Advanced: Raw Request Access

For advanced use cases, access the raw Node.js `IncomingMessage`:

```typescript
export const advancedHandler = defineMethod(async (args, ctx) => {
    const rawReq = ctx.req.raw;

    // Access socket information
    console.log("Remote address:", rawReq.socket.remoteAddress);
    console.log("Remote port:", rawReq.socket.remotePort);

    // Access HTTP version
    console.log("HTTP version:", rawReq.httpVersion);

    return { success: true };
});
```

RPC handlers receive the actual `POST /__helium__/rpc` request; streamed handlers receive `POST /__helium__/stream`. Headers and cookies are read for each request.

`ctx.signal` aborts when the caller disconnects or cancels. Pass it to upstream fetch/LLM requests and use `finally` to clean up resources. Cancellation requires the upstream operation to observe the signal; it cannot forcibly interrupt arbitrary application code.
