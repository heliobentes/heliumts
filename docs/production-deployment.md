# Production deployment

Helium's production build runs a persistent Node.js HTTP server with HTTP handlers, SSR, and HTTP/WebSocket RPC. Deploy `dist/server.js` to a host that runs Node.js and accepts WebSocket upgrades when using the WebSocket transport. Uploading `dist` to static hosting serves assets and generated pages, but does not run server methods or SSR.

## Build and start

Requires Node.js 20.19+ within Node 20, or Node.js 22.12+. React 18 and 19 are supported.

```bash
npm ci
npm run build
npm run start
```

For a typical app, these scripts are:

```json
{
    "scripts": {
        "dev": "helium dev",
        "build": "helium build",
        "start": "helium start"
    }
}
```

You can also start the built server directly from the project root:

```bash
NODE_ENV=production node dist/server.js
```

The built entry defaults `NODE_ENV` to `production` when it is unset. Both startup paths use `PORT` (default 3000), load production environment files from the working directory, and look for built configuration beside `server.js`. Signals reach the server and stop background workers before shutdown.

## Configuration in the build

`helium build` finds `helium.config.js`, `helium.config.mjs`, or `helium.config.ts`, in that order, and bundles it with its relative helpers into `dist/helium.config.js`. The same TypeScript configuration works during development without a separate TypeScript runtime loader.

Invalid configuration fails startup/build instead of silently replacing security or RPC settings with defaults. Keep configuration packages that remain external in the application's runtime dependencies.

A deployment contains:

```text
your-app/
├── dist/
│   ├── server.js
│   ├── helium.config.js       # Present when a config exists
│   ├── index.html             # SPA fallback
│   ├── index.ssg.html         # Present when / uses SSG
│   └── assets/
├── package.json
├── package-lock.json
└── node_modules/              # Runtime dependencies and external integrations
```

An explicit `HELIUM_CONFIG_DIR` overrides the config search directory. Leave it unset unless you intentionally deploy configuration separately.

## Environment variables

Set server secrets through the host's environment settings or a privately supplied environment file. Keep `.env*` files out of Git and out of the public static artifact.

- `PORT` selects the HTTP listening port.
- `HELIUM_SECRET` provides a stable connection-token signing secret. Set the same value on instances that share traffic. A generated fallback secret changes across restarts and is not shared across instances.
- Application database/API credentials stay server-side and must never be returned from RPC methods or SSR props.
- Only values prefixed `HELIUM_PUBLIC_` are intended for browser exposure. Use `getPublicEnv()` or `getPublicEnvValue()` from `heliumts/client`; `heliumts/client/env` is a smaller entry for browser-only code that does not need the router.

Production reads `.env`, `.env.production`, `.env.local`, and `.env.production.local`. More specific files take priority over less specific files; existing process environment values are not overwritten. Run from the directory containing those files if you use them.

The server injects public process environment values into HTML before the client runs. Values rendered into SSG content are fixed at build time; rebuild SSG pages when those values change. Do not assume that an environment update rewrites already generated page content.

## Reverse proxies and multiple instances

Set `trustProxyDepth` to the actual number of trusted proxies. The default is zero, which ignores forwarding headers. At positive depth, Helium selects `X-Forwarded-For` from the right, counting the socket peer as the first hop. The proxy must append the actual connection IP and overwrite provider-specific IP/protocol headers.

```ts
import type { HeliumConfig } from "heliumts/server";

export default {
    trustProxyDepth: 1,
    rpc: {
        transport: "auto",
        security: {
            maxConnectionsPerIP: 10,
            maxMessagesPerWindow: 100,
            rateLimitWindowMs: 60_000,
        },
    },
} satisfies HeliumConfig;
```

Use depth one only when that topology matches the deployment. See [proxy configuration](./proxy-configuration.md) for examples.

HTTP RPC limits share an IP window; WebSocket message limits are per connection. The limiter is process-local. Shared quotas across multiple instances need enforcement outside this in-memory limiter. Background workers start in each server instance unless their application configuration disables them; account for that when scaling consumers or scheduled work.

Configure the proxy to forward WebSocket upgrade headers and use appropriate connection timeouts. Even with HTTP RPC selected, the built application still needs its Node.js server for RPC handlers and SSR.

## Docker example

Build the app before running the runtime image. Use a supported Node.js image in both stages:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Exclude local dependencies, `.git`, and secret environment files from the Docker build context. Supply production secrets at runtime. If an external dependency requires an installation script, review and run its installation step rather than assuming `--ignore-scripts` works for that integration.

## Static-only hosting

Static hosting can serve SSG pages and SPA assets. It cannot run this Node server's SSR, RPC, custom HTTP endpoints, or workers. Configure route rewrites for the host and preserve per-route generated HTML before falling back to `index.html`. Test direct links as well as client navigation; a universal rewrite to the SPA shell can discard generated HTML.

## Release checks

Verify the actual built artifact after deployment:

1. Load an SSG page and an SSR page directly, then navigate to each from another route.
2. Confirm query parameters reach SSR props and private props are returned only to an authorized user.
3. Test the configured RPC transport, custom HTTP callbacks, and all expected cookies.
4. Check trusted client IP/protocol values behind the real proxy.
5. Confirm HTML is not shared-cached across users, and verify worker start/shutdown behavior.
