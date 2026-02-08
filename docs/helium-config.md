# Helium Configuration

## Overview

Helium's configuration file allows you to customize server settings, RPC behavior, security, and proxy configuration. The configuration file should be placed at the project root as `helium.config.ts`, `helium.config.js`, or `helium.config.mjs`.

## Basic Configuration

Create a `helium.config.ts` file in your project root:

```typescript
import type { HeliumConfig } from "heliumts/server";

const config: HeliumConfig = {
    // Your configuration here
};

export default config;
```

## Configuration Options

### RPC Configuration

The `rpc` section configures WebSocket-based RPC communication between client and server.

#### Transport Mode

Configure the client-side transport for RPC calls:

```typescript
const config: HeliumConfig = {
    rpc: {
        transport: "websocket",    // "websocket" | "http" | "auto"
        autoHttpOnMobile: false,   // Automatically use HTTP on mobile networks
    },
};
```

**Transport Options:**

- **`"websocket"`** (default): Uses persistent WebSocket connection
  - ✅ Lower latency for subsequent calls (connection reuse)
  - ✅ Real-time bidirectional communication ready
  - ⚠️ Higher initial connection overhead on high-latency networks

- **`"http"`**: Uses HTTP POST requests for each RPC call
  - ✅ Better performance on mobile/cellular networks (HTTP/2 optimizations)
  - ✅ No connection state to maintain
  - ⚠️ Slightly higher per-request overhead on fast networks

- **`"auto"`**: Automatically selects based on network conditions
  - Uses HTTP on cellular/slow networks when `autoHttpOnMobile` is `true`
  - Uses WebSocket on fast networks (WiFi, wired)

**Auto HTTP on Mobile:**

When `autoHttpOnMobile` is enabled and `transport` is set to `"auto"`, the client will automatically use HTTP transport on:
- Cellular connections (4G/LTE, 5G)
- Slow connections (2G, 3G)

This improves performance on mobile networks where HTTP/2 multiplexing is more efficient than WebSocket due to carrier network optimizations.

```typescript
// Optimize for mobile performance
const config: HeliumConfig = {
    rpc: {
        transport: "auto",
        autoHttpOnMobile: true,
    },
};
```

#### Compression

Configure WebSocket per-message compression (permessage-deflate extension):

```typescript
const config: HeliumConfig = {
    rpc: {
        compression: {
            enabled: true,     // Enable compression (default: true)
            threshold: 1024,   // Minimum message size in bytes to compress (default: 1024)
        },
    },
};
```

**Options:**

- `enabled` (boolean): Enable WebSocket per-message compression
  - Default: `true`
  - When enabled, messages are compressed before sending to reduce bandwidth usage

- `threshold` (number): Minimum message size in bytes to apply compression
  - Default: `1024` (1 KB)
  - Messages smaller than this threshold will not be compressed to avoid overhead
  - Only applies when compression is enabled

#### Security & Rate Limiting

Configure connection limits, message rate limits, and token validity:

```typescript
const config: HeliumConfig = {
    rpc: {
        security: {
            maxConnectionsPerIP: 10,        // Max concurrent WebSocket connections per IP
            maxMessagesPerWindow: 100,      // Max RPC messages per connection per time window
            rateLimitWindowMs: 60000,       // Time window for rate limiting (1 minute)
            tokenValidityMs: 30000,         // WebSocket connection token validity (30 seconds)
        },
    },
};
```

**Options:**

- `maxConnectionsPerIP` (number): Maximum number of concurrent WebSocket connections allowed per IP address
  - Default: `10`
  - Helps prevent a single client from exhausting connection resources
  - Set to `0` to disable this limit
  - Uses the client IP extracted based on `trustProxyDepth` configuration

- `maxMessagesPerWindow` (number): Maximum number of RPC messages allowed per connection within the time window
  - Default: `100`
  - Helps prevent abuse by limiting message throughput per connection
  - Set to `0` to disable rate limiting
  - Resets after `rateLimitWindowMs`

- `rateLimitWindowMs` (number): Time window in milliseconds for rate limiting
  - Default: `60000` (1 minute)
  - Rate limits reset after this duration
  - Lower values = stricter rate limiting, higher values = more permissive

- `tokenValidityMs` (number): WebSocket connection token validity duration in milliseconds
  - Default: `30000` (30 seconds)
  - Tokens are generated server-side and must be used within this timeframe
  - Shorter durations improve security but may cause issues with slow networks
  - If a client takes longer than this to connect, the token expires and connection fails

#### Payload Limits

Configure maximum payload sizes for RPC requests and WebSocket messages:

```typescript
const config: HeliumConfig = {
        rpc: {
                maxWsPayload: 10_485_760, // 10 MB max WebSocket message size
                maxBodySize: 10_485_760,  // 10 MB max HTTP RPC request body
                maxBatchSize: 50,         // Max RPC calls per batch
        },
};
```

**Options:**

- `maxWsPayload` (number): Maximum WebSocket message payload size in bytes
    - Default: `1048576` (1 MB)
    - Increase this for large binary uploads over WebSocket

- `maxBodySize` (number): Maximum HTTP RPC request body size in bytes
    - Default: `1048576` (1 MB)
    - Applies to the `POST /__helium__/rpc` endpoint

- `maxBatchSize` (number): Maximum number of RPC calls in a single batch
    - Default: `20`
    - Helps prevent oversized batch payloads

### Proxy Configuration

Configure IP detection for deployments behind proxies, load balancers, or CDNs.

```typescript
const config: HeliumConfig = {
    trustProxyDepth: 1, // Trust 1 proxy level
};
```

The `trustProxyDepth` setting tells Helium how many proxy levels to trust when extracting client IPs from headers like `X-Forwarded-For`. This is crucial for rate limiting and connection limits to work correctly.

**Values:**

- `0` (default): Don't trust any proxies, use direct connection IP
  - Most secure for local development
  - Use when not behind any proxies

- `1`: Trust 1 proxy level
  - Recommended for most production platforms (Vercel, Netlify, Railway)
  - Use when behind one proxy/load balancer

- `2+`: Trust multiple proxy levels
  - For complex setups like Cloudflare → Load Balancer → Your Server
  - Only trust as many proxy levels as you actually have

**Common configurations:**

```typescript
// Local development
trustProxyDepth: 0

// Vercel/Netlify/Railway
trustProxyDepth: 1

// Cloudflare → Your server
trustProxyDepth: 1

// Cloudflare → Nginx → Node.js
trustProxyDepth: 2

// AWS ALB → EC2
trustProxyDepth: 1
```

**Security note:** Setting this too high can allow IP spoofing. Only trust as many proxy levels as you actually have in your infrastructure.

See [Proxy Configuration](./proxy-configuration.md) for detailed information about IP detection.

## Complete Example

Here's a complete configuration example with all options:

```typescript
import type { HeliumConfig } from "heliumts/server";

const config: HeliumConfig = {
    // Trust 1 proxy level (e.g., Vercel)
    trustProxyDepth: 1,

    // RPC configuration
    rpc: {
        // Client-side transport mode
        transport: "websocket",    // Default: WebSocket for lowest latency
        autoHttpOnMobile: false,   // Set to true to optimize for mobile networks

        // Enable compression for messages over 1KB
        compression: {
            enabled: true,
            threshold: 1024,
        },

        // Security and rate limiting
        security: {
            maxConnectionsPerIP: 10,
            maxMessagesPerWindow: 100,
            rateLimitWindowMs: 60000,
            tokenValidityMs: 30000,
        },

        // Payload limits
        maxWsPayload: 10_485_760,
        maxBodySize: 10_485_760,
        maxBatchSize: 50,
    },
};

export default config;
```

## Environment-Specific Configuration

You can use environment variables to adjust configuration based on the deployment environment:

```typescript
import type { HeliumConfig } from "heliumts/server";

const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";

const config: HeliumConfig = {
    trustProxyDepth: isProduction ? 1 : 0,

    rpc: {
        compression: {
            enabled: isProduction,
            threshold: 1024,
        },

        security: {
            maxConnectionsPerIP: isDevelopment ? 100 : 10,
            maxMessagesPerWindow: isDevelopment ? 1000 : 100,
            rateLimitWindowMs: 60000,
            tokenValidityMs: 30000,
        },
    },
};

export default config;
```

## Production Deployment

### Automatic Transpilation

During `helium build`, the framework automatically handles TypeScript config files:

1. **If `helium.config.ts` exists**: Automatically transpiles it to `dist/helium.config.js`
2. **If `helium.config.js` exists**: Copies it to `dist/helium.config.js`
3. **If `helium.config.mjs` exists**: Copies it to `dist/helium.config.mjs`

When you run `helium start`, the production server looks for the config file in the `dist` directory first, then falls back to the project root.

### Manual Conversion

If you prefer using `.js` config files without transpilation:

```bash
# Rename to .js
mv helium.config.ts helium.config.js
```

Then update the syntax to JavaScript:

```javascript
// helium.config.js
export default {
    trustProxyDepth: 1,
    rpc: {
        compression: {
            enabled: true,
            threshold: 1024,
        },
        security: {
            maxConnectionsPerIP: 10,
            maxMessagesPerWindow: 100,
            rateLimitWindowMs: 60000,
            tokenValidityMs: 30000,
        },
    },
};
```

See [Production Deployment](./production-deployment.md) for more deployment details.

## Configuration Loading

The framework loads configuration in the following order:

1. Checks for `HELIUM_CONFIG_DIR` environment variable
2. Looks for config files in priority order:
   - `helium.config.js`
   - `helium.config.mjs`
   - `helium.config.ts` (only in development with Vite)
3. Falls back to default configuration if no file is found

Configuration is cached for the lifetime of the process.

## Default Values

If you don't provide a configuration file, Helium uses these defaults:

```typescript
{
    trustProxyDepth: 0,
    rpc: {
        compression: {
            enabled: true,
            threshold: 1024,
        },
        security: {
            maxConnectionsPerIP: 10,
            maxMessagesPerWindow: 100,
            rateLimitWindowMs: 60000,
            tokenValidityMs: 30000,
        },
    },
}
```

## Troubleshooting

### Config file not loading in production

**Symptoms:**
- Settings not being applied
- Rate limiting using default values

**Solutions:**
1. Ensure you ran `helium build` before deploying
2. Check that `dist/helium.config.js` exists after build
3. Verify you're running from the correct directory (where `dist/` exists)
4. Ensure `HELIUM_CONFIG_DIR` environment variable isn't incorrectly set

### Error: "Unknown file extension .ts"

**Symptoms:**
- Production server fails to start
- Error mentions `.ts` extension

**Solutions:**
1. Ensure your config was transpiled during build: `helium build` should create `dist/helium.config.js`
2. Alternatively, rename your config to `.js` or `.mjs` and use JavaScript syntax
3. Check that the build process completed successfully

### Rate limiting not working as expected

**Symptoms:**
- Users being rate limited too aggressively or not at all
- All users sharing the same limits

**Solutions:**
1. Verify `trustProxyDepth` is configured correctly for your deployment
2. Check that your proxy is setting the `X-Forwarded-For` header
3. Review the `maxConnectionsPerIP` and `maxMessagesPerWindow` settings
4. Ensure you're not setting limits to `0` (which disables them)

See [Proxy Configuration](./proxy-configuration.md) for detailed IP detection troubleshooting.

## Best Practices

1. **Use TypeScript for type safety**: The `HeliumConfig` type provides autocomplete and type checking
2. **Environment-specific settings**: Use environment variables to adjust settings per environment
3. **Start with defaults**: Only configure what you need to change from the defaults
4. **Monitor rate limits**: Adjust `maxMessagesPerWindow` based on your application's needs
5. **Test proxy configuration**: Use the Context API to verify IP detection is working correctly
6. **Enable compression**: Reduces bandwidth usage for large messages
7. **Set appropriate token validity**: Balance security (shorter) vs. network reliability (longer)

## Related Documentation

- [Proxy Configuration](./proxy-configuration.md) - Detailed guide on IP detection and proxy trust depth
- [Production Deployment](./production-deployment.md) - Deploy to production platforms
- [Context API](./context-api.md) - Access request metadata including client IPs
- [Rate Limiting](./context-api.md#rate-limiting-by-ip) - Implement custom rate limiting
