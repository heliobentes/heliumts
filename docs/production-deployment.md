# Production Deployment

## Platform Compatibility

Helium uses WebSocket-based RPC for real-time communication between client and server. This architecture requires a **persistent server process**, which affects your choice of hosting platform.

### ✅ Fully Compatible Platforms

These platforms support persistent Node.js servers and WebSocket connections:

| Platform | WebSocket Support | RPC Support | Notes |
|----------|------------------|-------------|-------|
| **Digital Ocean App Platform** | ✅ | ✅ | Recommended. Full support for all features |
| **Railway** | ✅ | ✅ | Excellent for quick deployments |
| **Render** | ✅ | ✅ | Free tier available |
| **Fly.io** | ✅ | ✅ | Great for edge deployments |
| **AWS EC2 / ECS** | ✅ | ✅ | Full control, requires more setup |
| **Google Cloud Run** | ✅ | ✅ | Set `--session-affinity` for WebSockets |
| **Heroku** | ✅ | ✅ | Use `heroku labs:enable http-session-affinity` |
| **Self-hosted / VPS** | ✅ | ✅ | Docker or direct Node.js |

### ⚠️ Limited Compatibility Platforms

These platforms have fundamental limitations that affect Helium features:

| Platform | Issue | What Works | What Doesn't Work |
|----------|-------|------------|-------------------|
| **Vercel** | Serverless (no persistent connections) | SSG pages, static assets | WebSocket RPC, direct URL navigation to dynamic routes |
| **Netlify** | Serverless (no persistent connections) | SSG pages, static assets | WebSocket RPC, direct URL navigation to dynamic routes |
| **Cloudflare Pages** | Serverless | SSG pages, static assets | WebSocket RPC |

### Using Helium on Vercel/Netlify (Limited Mode)

If you must use Vercel or Netlify, Helium can work in **SSG-only mode**:

1. **Pre-render all pages** using SSG (see [SSG documentation](./ssg.md))
2. **Avoid RPC calls** - use external APIs or pre-fetched data instead
3. **Add SPA fallback** with a `vercel.json`:

```json
{
    "rewrites": [
        { "source": "/(.*)", "destination": "/index.html" }
    ]
}
```

**Note:** Even with SPA fallback, refreshing a page or navigating directly to a URL (not from the home page) may fail if that route requires server-side data.

---

## Configuration Files in Production

When deploying your Helium application, the framework needs to load your `helium.config` file. The build process automatically handles TypeScript config files for you.

### Automatic Config Transpilation

During `helium build`, the framework:

1. **If `helium.config.ts` exists**: Automatically transpiles it to `dist/helium.config.js`
2. **If `helium.config.js` exists**: Copies it to `dist/helium.config.js`
3. **If `helium.config.mjs` exists**: Copies it to `dist/helium.config.mjs`

When you run `helium start`, the production server looks for the config file in the `dist` directory first, then falls back to the project root.

### Deployment Structure

After running `helium build`, your deployment should include:

```
your-app/
├── dist/
│   ├── server.js              # Bundled server code
│   ├── helium.config.js       # Transpiled config (if you had .ts)
│   ├── index.html             # Client entry
│   └── assets/                # Client bundles
├── package.json
└── node_modules/
```

### Platform-Specific Instructions

#### Digital Ocean App Platform

1. Set build command: `npm run build`
2. Set run command: `npm run start` (or directly: `helium start`)
3. Ensure `node_modules` is included in the deployment
4. Add environment variables in Settings → App-Level Environment Variables
    - Example: `DATABASE_URL`, `JWT_SECRET`, `PORT`, etc.
    - These will be available in `process.env` automatically

#### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# The config file should be in dist/ after build
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

#### Vercel / Netlify (Limited Support)

> ⚠️ **Important:** Vercel and Netlify are **serverless platforms** that do not support persistent WebSocket connections. This means:
> - **WebSocket-based RPC will not work**
> - **Direct URL navigation** to routes (other than the home page) will return 404 errors
> - Only **pre-rendered SSG pages** and **SPA navigation from the home page** work correctly

**If you need full Helium functionality, use a platform that supports persistent servers** (see [Platform Compatibility](#platform-compatibility) above).

For SSG-only deployments on Vercel, add a `vercel.json`:

```json
{
    "rewrites": [
        { "source": "/(.*)", "destination": "/index.html" }
    ]
}
```

For Netlify, add a `_redirects` file in your `public` folder:

```
/*    /index.html   200
```

### Manual Config Conversion

If you prefer to use `.js` config files in production without transpilation:

1. Rename your config file:

    ```bash
    mv helium.config.ts helium.config.js
    ```

2. Update the syntax to JavaScript:
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

## Environment Variables

### Client-Side Environment Variables

To expose environment variables to the browser, prefix them with `HELIUM_PUBLIC_`:

```bash
# .env or platform environment variables
HELIUM_PUBLIC_APP_NAME=My App
HELIUM_PUBLIC_API_URL=https://api.example.com
HELIUM_PUBLIC_FEATURE_FLAG=true
```

Access them in your React components using `getPublicEnv()` or `window.__HELIUM__.env`:

```typescript
import { getPublicEnv } from 'heliumts/client';

function MyComponent() {
    const env = getPublicEnv();
    const appName = env.HELIUM_PUBLIC_APP_NAME;
    const apiUrl = env.HELIUM_PUBLIC_API_URL;
    const featureEnabled = env.HELIUM_PUBLIC_FEATURE_FLAG === 'true';
    
    return <div>{appName} - {apiUrl}</div>;
}
```

**Important:**

- Runtime injection: Public environment variables are exposed through `window.__HELIUM__.env` for both dev and prod.
- Only `HELIUM_PUBLIC_*` variables are exposed to the browser for security reasons
- Server-side code can access all environment variables via `process.env`

### Using Platform Environment Variables (Recommended)

Most cloud platforms (Digital Ocean, Vercel, Heroku, etc.) provide their own environment variable management. This is the **recommended approach** for production:

**Digital Ocean App Platform:**

1. Go to your app's Settings → App-Level Environment Variables
2. Add your variables (e.g., `DATABASE_URL`, `API_KEY`, `HELIUM_PUBLIC_APP_NAME`)
3. They'll be automatically injected into `process.env` and exposed to the client if prefixed with `HELIUM_PUBLIC_`

**Advantages:**

- No need to deploy `.env` files
- Variables are managed securely by the platform
- Different values per environment (staging/production)
- No risk of committing secrets to git
- **No rebuild required** when changing client-side variables

### Using .env Files in Production

If you need to deploy `.env` files, you have two options:

**Option 1: Include in deployment**

Add `.env` files to your deployment artifacts. For Digital Ocean:

1. Remove `.env` from `.gitignore` (only for non-secret configs)
2. Or manually upload `.env` files via the platform UI

**Option 2: Copy during build**

Update your build process to copy `.env` files:

```json
{
    "scripts": {
        "build": "helium build && cp .env* dist/ 2>/dev/null || true"
    }
}
```

Then in production, run from the `dist` directory:

```bash
cd dist && node server.js
```

### Environment Variable Priority

Helium loads environment variables in this order (highest to lowest priority):

1. **Platform environment variables** (from hosting provider)
2. `.env.production.local`
3. `.env.local`
4. `.env.production`
5. `.env`

Existing `process.env` values are never overridden by `.env` files.

### Troubleshooting

**Warning: "No .env files found or no variables loaded"**

This warning appears when:

1. No `.env` files exist (normal if using platform variables)
2. `.env` files exist but contain no variables
3. Working directory doesn't contain `.env` files

**Solutions:**

- If using platform environment variables: Ignore this warning, it's expected
- If using `.env` files: Ensure they're in the same directory as `server.js`
- Check `process.cwd()` matches your `.env` file location

**Error: "Unknown file extension .ts"**

This means the config file wasn't transpiled during build. Ensure:

1. Your config file is at the project root as `helium.config.ts`
2. You ran `helium build` before deploying
3. The `dist/helium.config.js` file exists after build

**Config not loading in production**

Check that:

1. The config file is in the `dist` directory
2. You're running from the correct directory (where `dist/` exists)
3. The `HELIUM_CONFIG_DIR` environment variable isn't incorrectly set
