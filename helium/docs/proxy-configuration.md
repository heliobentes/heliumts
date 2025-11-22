# Proxy Configuration for IP Detection

## Overview

When deploying behind proxies (like Vercel, Cloudflare, AWS ALB, etc.), accurate client IP detection is crucial for rate limiting and connection limits. Without proper proxy configuration, the system might identify the proxy server's IP instead of the real client IP, causing issues like:

- Rate limiting the proxy instead of individual users
- Connection limits blocking legitimate traffic
- Inaccurate analytics and logging

## Configuration

Use the `trustProxyDepth` setting in your `helium.config.ts`:

```typescript
import type { HeliumConfig } from "helium/server";

const config: HeliumConfig = {
    security: {
        trustProxyDepth: 1, // Set based on your deployment
    },
};

export default config;
```

## How It Works

Helium checks multiple headers to extract the client IP, in order of reliability:

1. **CF-Connecting-IP** - Cloudflare's guaranteed client IP (most reliable when using Cloudflare)
2. **True-Client-IP** - Cloudflare Enterprise and Akamai
3. **X-Real-IP** - Set by Nginx and other proxies
4. **X-Forwarded-For** - Standard header containing IP chain: `clientIP, proxy1, proxy2, ..., lastProxy`
5. **req.socket.remoteAddress** - Direct connection IP (fallback)

The `trustProxyDepth` setting tells Helium how many proxy levels to trust:

- **0**: Don't trust proxies, use direct connection IP (default, safest for local dev)
- **1**: Trust 1 proxy level (most common for production)
- **2+**: Trust multiple proxy levels (complex deployments)

## Common Deployment Scenarios

### Vercel / Netlify / Railway

```typescript
security: {
    trustProxyDepth: 1,
}
```

These platforms add one proxy layer. The `X-Forwarded-For` header will look like:

```
X-Forwarded-For: 203.0.113.1, 198.51.100.1
```

- `203.0.113.1`: Real client IP ✓
- `198.51.100.1`: Platform's proxy

### Cloudflare → Your Server

```typescript
security: {
    trustProxyDepth: 1,
}
```

**Note**: When using Cloudflare, Helium automatically uses the `CF-Connecting-IP` header, which is more reliable than parsing `X-Forwarded-For`.

### AWS ALB → EC2

```typescript
security: {
    trustProxyDepth: 1,
}
```

### Nginx → Node.js

```typescript
security: {
    trustProxyDepth: 1,
}
```

**Note**: Helium automatically uses Nginx's `X-Real-IP` header when available.

### Cloudflare → Nginx → Node.js

```typescript
security: {
    trustProxyDepth: 2,
}
```

With two proxy layers:

```
X-Forwarded-For: 203.0.113.1, 198.51.100.1, 192.0.2.1
```

- `203.0.113.1`: Real client IP ✓
- `198.51.100.1`: Nginx proxy
- `192.0.2.1`: Cloudflare proxy

### Local Development

```typescript
security: {
    trustProxyDepth: 0, // Default
}
```

No proxies in local development, so use the direct connection IP.

## Security Considerations

### Setting trustProxyDepth Too Low

If you set it to 0 when behind a proxy:

- ❌ Rate limiting will apply to the proxy IP
- ❌ All users behind the proxy share the same limits
- ❌ Example: All Vercel users would be treated as one client

### Setting trustProxyDepth Too High

If you set it higher than your actual proxy depth:

- ⚠️ The system might use an incorrect IP
- ⚠️ Potential security risk if `X-Forwarded-For` is spoofed

### Best Practice

**Always set `trustProxyDepth` to match your exact proxy configuration.**

## Verifying Your Configuration

### 1. Check Your Deployment Architecture

Count the number of proxies between your users and your Node.js application:

- User → Vercel → Your app = 1 proxy
- User → Cloudflare → Vercel → Your app = 2 proxies
- User → ALB → Your app = 1 proxy

### 2. Test IP Detection

Add temporary logging to verify the detected IP:

```typescript
import { defineMethod } from "helium/server";

export const testIP = defineMethod(async (_args, ctx) => {
    // This will log the detected IP with your current config
    console.log("Detected IP:", ctx.req.ip);
    console.log("User-Agent:", ctx.req.headers["user-agent"]);
    return {
        ip: ctx.req.ip,
        headers: ctx.req.headers,
    };
});
```

### 3. Expected Results

- In production: Should see your real IP, not the proxy's
- In local dev: Should see `::1` or `127.0.0.1`

## Advanced: Custom IP Extraction

If you need custom IP extraction logic, you can import the utility functions:

```typescript
import { extractClientIP, extractClientIPFromRight } from "helium/server";

// In your HTTP handler
const clientIP = extractClientIP(req, 1);
```

### Available Functions

#### `extractClientIP(req, trustProxyDepth)`

Extracts the client IP by checking headers in order of reliability:

1. CF-Connecting-IP (Cloudflare)
2. True-Client-IP (Cloudflare Enterprise, Akamai)
3. X-Real-IP (Nginx)
4. X-Forwarded-For (Standard)
5. req.socket.remoteAddress (Direct connection)

```typescript
// When using Cloudflare:
// CF-Connecting-IP: "203.0.113.1"
extractClientIP(req, 1); // → "203.0.113.1"

// When using X-Forwarded-For:
// X-Forwarded-For: "203.0.113.1, 198.51.100.1, 192.0.2.1"
extractClientIP(req, 1); // → "203.0.113.1"
extractClientIP(req, 2); // → "203.0.113.1"
```

#### `extractClientIPFromRight(req, trustProxyDepth)`

Alternative method that skips the rightmost N trusted proxies (only for X-Forwarded-For):

```typescript
// X-Forwarded-For: "203.0.113.1, 198.51.100.1, 192.0.2.1"
extractClientIPFromRight(req, 1); // → "198.51.100.1" (skip last 1)
extractClientIPFromRight(req, 2); // → "203.0.113.1" (skip last 2)

// Note: CF-Connecting-IP, True-Client-IP, and X-Real-IP are still checked first
```

## Troubleshooting

### Rate Limiting Not Working Correctly

**Symptom**: All users share the same rate limit
**Solution**: Set `trustProxyDepth` to match your proxy setup

### Wrong IP in Logs

**Symptom**: Seeing proxy IPs instead of client IPs
**Solution**: Increase `trustProxyDepth` by 1

### Rate Limiting Too Aggressive

**Symptom**: Legitimate users getting blocked
**Solution**: Verify `trustProxyDepth` is not set too low

### All Connections from "unknown"

**Symptom**: IP detection returning "unknown"
**Solution**: Check if your proxy is setting the `X-Forwarded-For` header correctly

## Reference

### Supported Headers

Helium checks headers in this order:

| Header                   | Set By                        | Type      | Notes                          |
| ------------------------ | ----------------------------- | --------- | ------------------------------ |
| CF-Connecting-IP         | Cloudflare                    | Single IP | Most reliable for Cloudflare   |
| True-Client-IP           | Cloudflare Enterprise, Akamai | Single IP | Requires special configuration |
| X-Real-IP                | Nginx, other proxies          | Single IP | Common with Nginx              |
| X-Forwarded-For          | Most proxies                  | IP chain  | Standard but can be spoofed    |
| req.socket.remoteAddress | Direct connection             | Single IP | Fallback                       |

### X-Forwarded-For Header Format

```
X-Forwarded-For: client, proxy1, proxy2, ..., lastProxy
```

### Trust Model

Helium trusts the **leftmost N IPs** where N = chain length - trustProxyDepth

Example with `trustProxyDepth: 1`:

```
X-Forwarded-For: 203.0.113.1, 198.51.100.1
Chain length: 2
Trusted IPs: 2 - 1 = 1 (the first one)
Result: 203.0.113.1 ✓
```

### Header Priority

Single-value headers (CF-Connecting-IP, True-Client-IP, X-Real-IP) always take precedence over X-Forwarded-For because:

- They cannot be easily spoofed
- They represent a single, trusted value
- They are set by trusted infrastructure (Cloudflare, Nginx, etc.)
