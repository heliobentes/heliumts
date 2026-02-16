# HTTP Handlers

## Overview

HeliumTS provides `defineHTTPRequest` for creating custom HTTP endpoints. This is useful for:

- Webhooks (Stripe, GitHub, etc.)
- REST APIs
- Third-party integrations (Auth providers)
- File uploads/downloads
- Server-sent events

HTTP handlers receive a normalized `HTTPRequest` object and the Helium context.

## Basic Usage

```typescript
import { defineHTTPRequest } from "heliumts/server";

export const myEndpoint = defineHTTPRequest("GET", "/api/hello", async (req, ctx) => {
    return { message: "Hello World" };
});
```

### Supported HTTP Methods

- `GET` - Retrieve data
- `POST` - Create resources
- `PUT` - Update resources
- `PATCH` - Partial updates
- `DELETE` - Delete resources
- `ALL` - Match any HTTP method

```typescript
// Match any method
export const catchAll = defineHTTPRequest("ALL", "/api/webhook", async (req, ctx) => {
    console.log(`Received ${req.method} request`);
    return { received: true };
});
```

## Dynamic Routes

Use `:param` syntax for dynamic path segments:

```typescript
export const getUser = defineHTTPRequest("GET", "/api/users/:id", async (req, ctx) => {
    const userId = req.params.id;
    const user = await db.users.findById(userId);
    return { user };
});

export const getProduct = defineHTTPRequest("GET", "/api/products/:category/:id", async (req, ctx) => {
    const { category, id } = req.params;
    return { category, id };
});
```

### Catch-All Routes

Use `*` to match a **single** path segment, or `/**` to match **multiple** segments.
This keeps default matching safe and predictable while still allowing deep matches
when you need them (e.g., auth providers or proxies).

```typescript
import { defineHTTPRequest } from "heliumts/server";
import { auth } from "./auth"; // Better Auth or similar

// Matches /api/auth/signin, /api/auth/signout, /api/auth/callback/google, etc.
export const authHandler = defineHTTPRequest("ALL", "/api/auth/**", async (req, ctx) => {
    // Convert to Web Request for third-party auth libraries
    const webRequest = await req.toWebRequest();

    // Pass to auth handler (Better Auth, Auth.js, etc.)
    return auth.handler(webRequest);
});
```

## Dynamic Social Meta Tags (No SSR)

If your app is frontend-only and you still need per-slug social previews (`og:*`, `twitter:*`),
use `defineSEOMetadata` instead of creating a broad HTTP endpoint.

`defineSEOMetadata` only runs for requests that already match a **normal page route**,
so it won't capture asset/module URLs.

```typescript
import { defineSEOMetadata } from "heliumts/server";

async function getPostMeta(slug: string) {
    // Replace with CMS/DB lookup
    if (slug === "hello-world") {
        return {
            title: "Hello World",
            description: "First post description",
            image: "https://example.com/images/hello-world.jpg",
            canonicalUrl: "https://example.com/posts/hello-world",
            type: "article" as const,
        };
    }

    return null;
}

// Runs only after a page route matches (for example /src/pages/posts/[slug].tsx)
export const postSEO = defineSEOMetadata("/posts/:slug", async (req) => {
    const slug = String(req.params.slug);
    const meta = await getPostMeta(slug);

    if (!meta) {
        return {
            title: "Post not found",
            description: "This post does not exist",
            robots: "noindex, nofollow",
        };
    }

    return meta;
});
```

This keeps your app as SPA (no full SSR), while link crawlers receive page-specific metadata.

## Request Object

The `HTTPRequest` object provides access to request data:

```typescript
export const myHandler = defineHTTPRequest("POST", "/api/data", async (req, ctx) => {
    // HTTP method
    console.log(req.method); // "POST"

    // Path
    console.log(req.path); // "/api/data"

    // Headers
    const contentType = req.headers["content-type"];
    const authorization = req.headers["authorization"];

    // Query parameters
    const search = req.query.q;
    const page = req.query.page;

    // Route parameters
    const id = req.params.id;

    // Cookies
    const sessionId = req.cookies.sessionId;

    // Parse JSON body
    const body = await req.json();

    // Parse text body
    const text = await req.text();

    return { success: true };
});
```

### Request Properties

| Property  | Type                                 | Description                   |
| --------- | ------------------------------------ | ----------------------------- |
| `method`  | `string`                             | HTTP method (GET, POST, etc.) |
| `path`    | `string`                             | Request path                  |
| `headers` | `Record<string, string \| string[]>` | HTTP headers                  |
| `query`   | `Record<string, string>`             | Query string parameters       |
| `params`  | `Record<string, string>`             | Dynamic route parameters      |
| `cookies` | `Record<string, string>`             | Parsed cookies                |

### Request Methods

| Method           | Return Type         | Description                           |
| ---------------- | ------------------- | ------------------------------------- |
| `json()`         | `Promise<unknown>`  | Parse request body as JSON            |
| `text()`         | `Promise<string>`   | Get request body as text              |
| `formData()`     | `Promise<FormData>` | Parse form data (not yet implemented) |
| `toWebRequest()` | `Promise<Request>`  | Convert to Web API Request            |

## Setting Response Headers

To set custom response headers, return a standard Web API `Response` object:

```typescript
import { defineHTTPRequest } from "heliumts/server";

export const customHeaders = defineHTTPRequest("GET", "/api/data", async (req, ctx) => {
    const data = { message: "Hello World" };

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "my-value",
            "Cache-Control": "max-age=3600",
            "X-RateLimit-Remaining": "100",
        },
    });
});
```

### Common Response Headers

#### Cache Control

```typescript
export const cachedEndpoint = defineHTTPRequest("GET", "/api/static-data", async (req, ctx) => {
    const data = await getStaticData();

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        },
    });
});
```

#### CORS Headers

```typescript
export const corsEndpoint = defineHTTPRequest("GET", "/api/public", async (req, ctx) => {
    return new Response(JSON.stringify({ data: "public" }), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
});

// Handle OPTIONS preflight
export const corsOptions = defineHTTPRequest("OPTIONS", "/api/public", async (req, ctx) => {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
});
```

#### Custom Headers

```typescript
export const apiWithHeaders = defineHTTPRequest("GET", "/api/metrics", async (req, ctx) => {
    const metrics = await getMetrics();

    return new Response(JSON.stringify(metrics), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "X-Request-ID": crypto.randomUUID(),
            "X-Response-Time": "42ms",
            "X-Server-Version": "1.0.0",
        },
    });
});
```

#### Content Disposition (Downloads)

```typescript
export const downloadFile = defineHTTPRequest("GET", "/api/download/:filename", async (req, ctx) => {
    const filename = req.params.filename;
    const fileContent = await getFileContent(filename);

    return new Response(fileContent, {
        status: 200,
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
});
```

## Status Codes

Control the HTTP status code via the `Response` object:

```typescript
export const statusExamples = defineHTTPRequest("POST", "/api/resource", async (req, ctx) => {
    const body = await req.json();

    // Success - 201 Created
    if (body.action === "create") {
        return new Response(JSON.stringify({ id: "123" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Client error - 400 Bad Request
    if (!body.email) {
        return new Response(JSON.stringify({ error: "Email required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Not found - 404
    if (!resourceExists(body.id)) {
        return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Unauthorized - 401
    if (!isAuthenticated(ctx)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Success - 200 OK
    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
```

### Common Status Codes

| Code | Meaning               | Use Case                      |
| ---- | --------------------- | ----------------------------- |
| 200  | OK                    | Successful request            |
| 201  | Created               | Resource created successfully |
| 204  | No Content            | Success with no response body |
| 400  | Bad Request           | Invalid request data          |
| 401  | Unauthorized          | Authentication required       |
| 403  | Forbidden             | Insufficient permissions      |
| 404  | Not Found             | Resource doesn't exist        |
| 429  | Too Many Requests     | Rate limit exceeded           |
| 500  | Internal Server Error | Server error                  |

## Streaming Responses

Return streaming responses using Web API streams:

```typescript
export const streamData = defineHTTPRequest("GET", "/api/stream", async (req, ctx) => {
    const stream = new ReadableStream({
        async start(controller) {
            for (let i = 0; i < 10; i++) {
                controller.enqueue(`data: ${i}\n\n`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
});
```

## Context Access

Access request metadata through the context:

```typescript
export const contextExample = defineHTTPRequest("POST", "/api/data", async (req, ctx) => {
    // Client IP address
    console.log("Client IP:", ctx.req.ip);

    // Request headers
    const userAgent = ctx.req.headers["user-agent"];

    // Request URL
    console.log("URL:", ctx.req.url);

    // HTTP method
    console.log("Method:", ctx.req.method);

    return { success: true };
});
```

See [Context API](./context-api.md) for more information.

## Integration with Third-Party Libraries

### Converting to Web Request

Use `toWebRequest()` to convert Helium's request to a standard Web API `Request`:

```typescript
import { defineHTTPRequest } from "heliumts/server";
import { auth } from "./auth"; // Better Auth or similar

export const authHandler = defineHTTPRequest("ALL", "/auth/:provider", async (req, ctx) => {
    // Convert to Web Request for third-party libraries
    const webRequest = await req.toWebRequest();

    // Pass to third-party handler
    return auth.handler(webRequest);
});
```

### Stripe Webhook

```typescript
import { defineHTTPRequest } from "heliumts/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const stripeWebhook = defineHTTPRequest("POST", "/webhooks/stripe", async (req, ctx) => {
    const body = await req.text();
    const signature = req.headers["stripe-signature"] as string;

    try {
        const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);

        // Handle event
        switch (event.type) {
            case "payment_intent.succeeded":
                // Handle payment
                break;
            case "customer.subscription.deleted":
                // Handle cancellation
                break;
        }

        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: "Webhook signature verification failed" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }
});
```

### GitHub Webhook

```typescript
import { defineHTTPRequest } from "heliumts/server";
import crypto from "crypto";

export const githubWebhook = defineHTTPRequest("POST", "/webhooks/github", async (req, ctx) => {
    const body = await req.text();
    const signature = req.headers["x-hub-signature-256"] as string;

    // Verify signature
    const hmac = crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!);
    const digest = "sha256=" + hmac.update(body).digest("hex");

    if (signature !== digest) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const event = JSON.parse(body);

    // Handle GitHub event
    console.log("GitHub event:", event);

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
```

### OpenAI API (Non-Streaming)

```typescript
import { defineHTTPRequest } from "heliumts/server";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const chatCompletion = defineHTTPRequest("POST", "/api/chat", async (req, ctx) => {
    const { message } = (await req.json()) as { message: string };

    if (!message) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: message }],
        });

        const response = completion.choices[0]?.message?.content || "";

        return new Response(
            JSON.stringify({
                response,
                usage: completion.usage,
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("OpenAI API error:", error);

        return new Response(
            JSON.stringify({
                error: "Failed to get completion",
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
});
```

### OpenAI API (Streaming)

```typescript
import { defineHTTPRequest } from "heliumts/server";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const chatCompletionStream = defineHTTPRequest("POST", "/api/chat/stream", async (req, ctx) => {
    const { message } = (await req.json()) as { message: string };

    if (!message) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const stream = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: message }],
            stream: true,
        });

        // Create a ReadableStream from the OpenAI stream
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
                        const content = chunk.choices[0]?.delta?.content || "";
                        if (content) {
                            // Send as SSE format
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`));
                        }
                    }
                    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            },
        });

        return new Response(readableStream, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch (error) {
        console.error("OpenAI API error:", error);

        return new Response(
            JSON.stringify({
                error: "Failed to get completion",
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
});
```

## Simple JSON Responses

For simple cases, you can return plain objects (automatically converted to JSON with 200 status):

```typescript
export const simpleEndpoint = defineHTTPRequest("GET", "/api/simple", async (req, ctx) => {
    // Returns JSON with 200 status and Content-Type: application/json
    return { message: "Hello World" };
});
```

**Note:** Returning plain objects doesn't allow custom headers or status codes. Use `Response` objects for full control.

## Error Handling

```typescript
export const safeEndpoint = defineHTTPRequest("POST", "/api/process", async (req, ctx) => {
    try {
        const data = await req.json();
        const result = await processData(data);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error processing request:", error);

        return new Response(
            JSON.stringify({
                error: "Processing failed",
                message: error instanceof Error ? error.message : "Unknown error",
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
});
```

## Best Practices

1. **Use `Response` for control**: Return `Response` objects when you need custom headers or status codes
2. **Set appropriate status codes**: Use correct HTTP status codes for different scenarios
3. **Add cache headers**: Use `Cache-Control` for cacheable responses
4. **Validate input**: Always validate request data before processing
5. **Handle errors gracefully**: Catch errors and return appropriate error responses
6. **Set CORS headers**: Add CORS headers for public APIs
7. **Verify webhooks**: Always verify webhook signatures
8. **Use TypeScript**: Type your request/response data
9. **Log important events**: Log webhook events and errors
10. **Return early**: Return error responses early to avoid unnecessary processing

## TypeScript Support

Type your handler's return value:

```typescript
interface User {
    id: string;
    name: string;
    email: string;
}

export const getUser = defineHTTPRequest("GET", "/api/users/:id", async (req, ctx): Promise<Response> => {
    const userId = req.params.id;
    const user = await db.users.findById(userId);

    if (!user) {
        return new Response(JSON.stringify({ error: "User not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(user satisfies User), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
});
```

## Related Documentation

- [Context API](./context-api.md) - Access request metadata
- [Middleware](../README.md#middleware) - Add authentication and validation
- [Configuration](./helium-config.md) - Configure server settings
