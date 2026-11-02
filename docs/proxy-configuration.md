# Proxy configuration

Set `trustProxyDepth` to the number of trusted proxies between the client and the Helium server. It defaults to `0`, which ignores forwarding headers and uses the direct socket address and protocol.

```ts
import type { HeliumConfig } from "heliumts/server";

export default {
    trustProxyDepth: 1,
} satisfies HeliumConfig;
```

With forwarding enabled, Helium reads `X-Forwarded-For` from the right. The direct socket counts as the first trusted hop. This prevents client-supplied prefixes from replacing the IP used by rate limits and request context.

| Request topology | Header received by Helium | Depth | Selected client IP |
| --- | --- | --- | --- |
| Client → proxy → Helium | `203.0.113.8` | 1 | `203.0.113.8` |
| Client with spoofed prefix → proxy → Helium | `1.1.1.1, 203.0.113.8` | 1 | `203.0.113.8` |
| Client → edge → proxy → Helium | `203.0.113.8, 10.0.0.1` | 2 | `203.0.113.8` |

The immediate peer does not appear in `X-Forwarded-For`; its address comes from the socket. If the configured depth exceeds the available chain or the selected address is invalid, Helium uses the socket address.

When `X-Forwarded-For` is absent, a positive trust depth also permits a valid `CF-Connecting-IP`, `True-Client-IP`, or `X-Real-IP`, in that order. The trusted proxy must overwrite these values. When `X-Forwarded-For` is present, these fallback headers cannot override it.

`extractClientIP` and `extractClientIPFromRight` use the same depth-based behavior:

```ts
import { extractClientIP, extractClientIPFromRight } from "heliumts/server";

// X-Forwarded-For: "1.1.1.1, 203.0.113.8, 10.0.0.1"
extractClientIP(req, 1);          // "10.0.0.1"
extractClientIP(req, 2);          // "203.0.113.8"
extractClientIPFromRight(req, 2); // "203.0.113.8"
```

## Request protocol

`HTTPRequest.toWebRequest()` uses HTTPS for an encrypted socket. It accepts `X-Forwarded-Proto` only when proxy trust is enabled, and only accepts `http` or `https`. A comma-separated protocol chain is selected from the right using the same trusted depth; a single overwritten protocol value is also supported.

## Deployment checks

Count the actual proxy hops in your deployment. Configure the proxy to append the connection IP to `X-Forwarded-For`, overwrite provider-specific IP headers and `X-Forwarded-Proto`, and prevent clients from reaching Helium directly when proxy headers are trusted. Check both the normal proxy path and any shorter path before enabling trust.

A depth that is too low can identify a proxy as the client, sharing limits between users. A depth that is too high can trust an address supplied by the client. Do not increase the depth merely to change the logged address.

To inspect the current result in a development environment:

```ts
import { defineMethod } from "heliumts/server";

export const inspectClientIP = defineMethod(async (_args, ctx) => ({
    ip: ctx.req.ip,
}));
```

Both HTTP RPC and WebSocket RPC use the extracted IP. HTTP limits share a window per IP; WebSocket message windows are per connection, with a separate concurrent-connection limit per IP. `rpc.security.maxMessagesPerWindow: 0` disables message rate limits for both transports.
