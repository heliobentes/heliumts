# Helium configuration

Place `helium.config.ts`, `helium.config.js`, or `helium.config.mjs` at the project root. RPC calls and streamed methods use HTTP. The same configuration applies during development and production.

```ts
import type { HeliumConfig } from "heliumts/server";

export default {
    trustProxyDepth: 0,
    rpc: {
        maxBodySize: 1_048_576,
        maxBatchSize: 20,
        security: {
            maxRequestsPerWindow: 100,
            rateLimitWindowMs: 60_000,
            tokenValidityMs: 30_000,
        },
    },
} satisfies HeliumConfig;
```

## RPC limits

| Option | Default | Meaning |
| --- | --- | --- |
| `rpc.maxBodySize` | 1,048,576 bytes | Maximum encoded HTTP RPC or streaming request body; larger requests receive 413. |
| `rpc.maxBatchSize` | 20 | Maximum method calls in one ordinary RPC envelope. The client splits larger concurrent groups. Streaming calls use separate requests. |
| `rpc.security.maxRequestsPerWindow` | 100 | HTTP RPC requests per client IP in a rate-limit window. One batch envelope or one stream counts as one request. Set 0 to disable the limit. |
| `rpc.security.rateLimitWindowMs` | 60,000 ms | Length of the rate-limit window. |
| `rpc.security.tokenValidityMs` | 30,000 ms | Lifetime of the framework's signed request token. Clients obtain tokens on demand and refresh once after an unauthorized response. |

Tokens protect the framework endpoint; application authorization belongs in method handlers or [middleware](./middleware.md). A token is not an authenticated user session.

Ordinary RPC responses negotiate Brotli, gzip, or deflate through `Accept-Encoding`. Compression is handled by the framework without a transport or compression setting. Streaming responses are sent incrementally without whole-response compression; each encoded stream frame is capped at 10 MiB. The client hook has a configurable idle timeout; see [streaming](./streaming.md).

The in-memory request limiter is process-local. Multiple instances need an external shared limiter for global quotas. Users behind a NAT can share an IP; choose limits that fit the application and configure proxy trust correctly.

## Proxy configuration

`trustProxyDepth` defaults to 0. Forwarding headers are ignored at depth zero. Set the exact number of trusted proxy hops between the browser and the Node server; depth 1 fits a single trusted reverse proxy.

```ts
import type { HeliumConfig } from "heliumts/server";

export default {
    trustProxyDepth: 1,
} satisfies HeliumConfig;
```

Helium selects forwarded IPs from the right, counting the direct peer as the first trusted hop. The proxy must overwrite provider-specific IP and protocol headers. See [proxy configuration](./proxy-configuration.md) for topology examples.

## HTTP security headers

```ts
import type { HeliumConfig } from "heliumts/server";

export default {
    security: {
        defaultHeaders: true,
        headerOverrides: {
            "X-Frame-Options": "SAMEORIGIN",
            "Permissions-Policy": null,
            "X-Application": "example",
        },
        contentSecurityPolicy: "default-src 'self'; frame-ancestors 'self'",
        hsts: true,
        corsOrigins: ["https://app.example.com"],
    },
} satisfies HeliumConfig;
```

- `security.defaultHeaders` defaults to `true`. Set it to `false` for full manual header control.
- `security.headerOverrides` runs last. A string sets a header; `null` removes it.
- `security.contentSecurityPolicy` adds the supplied CSP when default headers are enabled.
- `security.hsts` defaults to `true` when default headers are enabled.
- `security.corsOrigins` defaults to an empty list for same-origin requests. Configure explicit allowed origins when required.

## Environment-specific settings

```ts
import type { HeliumConfig } from "heliumts/server";

const production = process.env.NODE_ENV === "production";

export default {
    trustProxyDepth: production ? 1 : 0,
    rpc: {
        security: {
            maxRequestsPerWindow: production ? 100 : 1000,
            rateLimitWindowMs: 60_000,
        },
    },
} satisfies HeliumConfig;
```

Use a positive proxy depth only when that topology matches the deployment.

## Configuration loading and production builds

The loader checks `helium.config.js`, `helium.config.mjs`, then `helium.config.ts`. A config must default-export an object. Defaults apply when no file exists; a config that exists but fails to build or evaluate produces an error.

`helium build` bundles the config and local imports into `dist/helium.config.js`; package dependencies remain external. Both `helium start` and `node dist/server.js` load the built configuration first, then fall back to the project root. `HELIUM_CONFIG_DIR` overrides the search directory. Configuration is cached per project/config directory; development reloads it when the config changes.

See [production deployment](./production-deployment.md) for environment variables, proxies, and scaling.

## Client recovery

Helium's client detects stale chunks and long background suspensions and uses guarded reload recovery when needed. This behavior needs no config option. HTTP RPC authorization tokens are fetched on demand, with no persistent connection or periodic refresh timer.

## Upgrading to 0.10

Remove `rpc.transport`, `rpc.autoHttpOnMobile`, `rpc.compression`, `rpc.maxWsPayload`, and `rpc.security.maxConnectionsPerIP`. Rename `maxMessagesPerWindow` to `maxRequestsPerWindow` and review its per-IP request semantics. These obsolete settings no longer select a transport or configure socket behavior.
